#include "ui_automation_bridge.h"
#include "ui_automation_input.h"
#include "native_helpers.h"

#include <ole2.h>
#include <oleacc.h>
#include <UIAutomation.h>
#include <wrl/client.h>

#include <algorithm>
#include <climits>
#include <sstream>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;

namespace {
class ComScope {
 public:
  ComScope() : result_(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)) {}
  ~ComScope() { if (SUCCEEDED(result_)) CoUninitialize(); }
  bool usable() const { return SUCCEEDED(result_) || result_ == RPC_E_CHANGED_MODE; }
 private:
  HRESULT result_;
};

struct UiNode {
  ComPtr<IUIAutomationElement> element;
  int depth;
};

void SetNamed(napi_env env, napi_value object, const char* name, napi_value value) {
  napi_set_named_property(env, object, name, value);
}

napi_value IntValue(napi_env env, int value) {
  napi_value result;
  napi_create_int32(env, value, &result);
  return result;
}

napi_value StringValue(napi_env env, const std::wstring& value) {
  napi_value result;
  napi_create_string_utf16(
      env, reinterpret_cast<const char16_t*>(value.c_str()), value.size(), &result);
  return result;
}

std::wstring ReadBstr(BSTR value, size_t limit = 160) {
  if (!value) return L"";
  std::wstring text(value, SysStringLen(value));
  SysFreeString(value);
  for (wchar_t& character : text) {
    if (character == L'\r' || character == L'\n' || character == L'\t') character = L' ';
  }
  if (text.size() > limit) text.resize(limit);
  return text;
}

void ThrowHresult(napi_env env, const char* operation, HRESULT result) {
  char message[160];
  sprintf_s(message, "%s failed (HRESULT 0x%08lX)", operation,
      static_cast<unsigned long>(result));
  napi_throw_error(env, nullptr, message);
}

bool ValidateTarget(napi_env env, HWND child, DWORD expected_pid) {
  if (!IsWindow(child)) {
    napi_throw_error(env, nullptr, "bound software window is no longer available");
    return false;
  }
  DWORD actual_pid = 0;
  GetWindowThreadProcessId(child, &actual_pid);
  if (!expected_pid || actual_pid != expected_pid) {
    napi_throw_error(env, nullptr, "bound software window identity has changed");
    return false;
  }
  DWORD current_session = 0;
  DWORD child_session = 0;
  ProcessIdToSessionId(GetCurrentProcessId(), &current_session);
  ProcessIdToSessionId(actual_pid, &child_session);
  if (current_session != child_session) {
    napi_throw_error(env, nullptr, "cross-session UI Automation is forbidden");
    return false;
  }
  return true;
}

bool WindowBelongsToProcess(HWND window, DWORD expected_pid) {
  if (!IsWindow(window)) return false;
  DWORD actual_pid = 0;
  GetWindowThreadProcessId(window, &actual_pid);
  return actual_pid == expected_pid;
}

bool IsOwnedBy(HWND window, HWND expected_owner) {
  HWND owner = GetWindow(window, GW_OWNER);
  for (int depth = 0; owner && depth < 16; ++depth) {
    if (owner == expected_owner) return true;
    owner = GetWindow(owner, GW_OWNER);
  }
  return false;
}

bool PointBelongsToBoundWindow(POINT point, HWND child, DWORD expected_pid) {
  const HWND hit = WindowFromPoint(point);
  if (!WindowBelongsToProcess(hit, expected_pid)) return false;
  for (HWND current = hit; current; current = GetParent(current)) {
    if (current == child) return true;
  }
  const HWND root = GetAncestor(hit, GA_ROOT);
  return root == child || IsOwnedBy(root, child);
}

struct PopupSearch {
  HWND child;
  DWORD pid;
  HWND found;
};

BOOL CALLBACK FindOwnedPopup(HWND candidate, LPARAM parameter) {
  auto* search = reinterpret_cast<PopupSearch*>(parameter);
  if (candidate == search->child || !IsWindowVisible(candidate)
      || !WindowBelongsToProcess(candidate, search->pid)
      || !IsOwnedBy(candidate, search->child)) return TRUE;
  search->found = candidate;
  return FALSE;
}

HWND ResolveAutomationWindow(HWND child, DWORD expected_pid) {
  const HWND popup = GetLastActivePopup(child);
  if (popup != child
      && IsWindowVisible(popup)
      && WindowBelongsToProcess(popup, expected_pid)
      && IsOwnedBy(popup, child)) {
    SetWindowPos(
        popup, HWND_TOP, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    return popup;
  }
  PopupSearch search = { child, expected_pid, nullptr };
  EnumWindows(FindOwnedPopup, reinterpret_cast<LPARAM>(&search));
  if (search.found) {
    SetWindowPos(
        search.found, HWND_TOP, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }
  return search.found ? search.found : child;
}

ComPtr<IUIAutomation> CreateAutomation(napi_env env) {
  ComPtr<IUIAutomation> automation;
  const HRESULT result = CoCreateInstance(
      CLSID_CUIAutomation, nullptr, CLSCTX_INPROC_SERVER,
      IID_PPV_ARGS(&automation));
  if (FAILED(result)) ThrowHresult(env, "CoCreateInstance(CUIAutomation)", result);
  ComPtr<IUIAutomation2> bounded;
  if (automation && SUCCEEDED(automation.As(&bounded))) {
    bounded->put_ConnectionTimeout(2000);
    bounded->put_TransactionTimeout(5000);
  }
  return automation;
}

ComPtr<IUIAutomationElement> RootElement(
    napi_env env, IUIAutomation* automation, HWND child, DWORD expected_pid) {
  ComPtr<IUIAutomationElement> root;
  const HRESULT result = automation->ElementFromHandle(child, &root);
  if (FAILED(result) || !root) {
    ThrowHresult(env, "ElementFromHandle", result);
    return nullptr;
  }
  int process_id = 0;
  if (FAILED(root->get_CurrentProcessId(&process_id))
      || static_cast<DWORD>(process_id) != expected_pid) {
    napi_throw_error(env, nullptr, "UI Automation root does not match the bound process");
    return nullptr;
  }
  return root;
}

std::wstring RuntimeRef(IUIAutomationElement* element) {
  SAFEARRAY* runtime_id = nullptr;
  if (FAILED(element->GetRuntimeId(&runtime_id)) || !runtime_id) return L"";
  LONG lower = 0;
  LONG upper = -1;
  SafeArrayGetLBound(runtime_id, 1, &lower);
  SafeArrayGetUBound(runtime_id, 1, &upper);
  std::wstringstream stream;
  stream << L"uia:";
  for (LONG index = lower; index <= upper; ++index) {
    int value = 0;
    SafeArrayGetElement(runtime_id, &index, &value);
    if (index > lower) stream << L",";
    stream << value;
  }
  SafeArrayDestroy(runtime_id);
  return stream.str();
}

std::vector<int> ParseRuntimeRef(const std::wstring& ref) {
  if (ref.rfind(L"uia:", 0) != 0) return {};
  std::vector<int> values;
  std::wstringstream stream(ref.substr(4));
  std::wstring item;
  while (std::getline(stream, item, L',')) {
    if (item.empty()) return {};
    wchar_t* end = nullptr;
    const long value = wcstol(item.c_str(), &end, 10);
    if (!end || *end != L'\0') return {};
    values.push_back(static_cast<int>(value));
  }
  return values;
}

std::wstring ControlTypeName(CONTROLTYPEID type) {
  switch (type) {
    case UIA_ButtonControlTypeId: return L"button";
    case UIA_CheckBoxControlTypeId: return L"checkbox";
    case UIA_ComboBoxControlTypeId: return L"combobox";
    case UIA_EditControlTypeId: return L"edit";
    case UIA_HyperlinkControlTypeId: return L"link";
    case UIA_ListControlTypeId: return L"list";
    case UIA_ListItemControlTypeId: return L"listitem";
    case UIA_MenuControlTypeId: return L"menu";
    case UIA_MenuItemControlTypeId: return L"menuitem";
    case UIA_RadioButtonControlTypeId: return L"radio";
    case UIA_TabControlTypeId: return L"tab";
    case UIA_TabItemControlTypeId: return L"tabitem";
    case UIA_TextControlTypeId: return L"text";
    case UIA_TreeControlTypeId: return L"tree";
    case UIA_TreeItemControlTypeId: return L"treeitem";
    case UIA_WindowControlTypeId: return L"window";
    default: return L"control";
  }
}

bool SupportsPattern(IUIAutomationElement* element, PATTERNID pattern) {
  ComPtr<IUnknown> value;
  return SUCCEEDED(element->GetCurrentPattern(pattern, &value)) && value;
}

std::wstring CurrentValue(IUIAutomationElement* element) {
  ComPtr<IUIAutomationValuePattern> pattern;
  element->GetCurrentPatternAs(
      UIA_ValuePatternId, IID_PPV_ARGS(&pattern));
  if (!pattern) return L"";
  BSTR value = nullptr;
  return SUCCEEDED(pattern->get_CurrentValue(&value)) ? ReadBstr(value) : L"";
}

napi_value ActionsValue(napi_env env, IUIAutomationElement* element) {
  const std::pair<PATTERNID, const char*> patterns[] = {
    { UIA_InvokePatternId, "invoke" },
    { UIA_ValuePatternId, "set_value" },
    { UIA_TogglePatternId, "toggle" },
    { UIA_SelectionItemPatternId, "select" },
    { UIA_ExpandCollapsePatternId, "expand_collapse" },
  };
  napi_value actions;
  napi_create_array(env, &actions);
  uint32_t index = 0;
  for (const auto& pattern : patterns) {
    if (!SupportsPattern(element, pattern.first)) continue;
    napi_value value;
    napi_create_string_utf8(env, pattern.second, NAPI_AUTO_LENGTH, &value);
    napi_set_element(env, actions, index++, value);
  }
  return actions;
}

napi_value ElementValue(
    napi_env env, IUIAutomationElement* element, int depth,
    HWND child, DWORD expected_pid) {
  BSTR raw_name = nullptr;
  BSTR raw_id = nullptr;
  BSTR raw_class = nullptr;
  BSTR raw_framework = nullptr;
  CONTROLTYPEID control_type = 0;
  UIA_HWND native_window = 0;
  BOOL enabled = FALSE;
  BOOL offscreen = FALSE;
  BOOL focused = FALSE;
  BOOL password = FALSE;
  RECT rect = {};
  element->get_CurrentName(&raw_name);
  element->get_CurrentAutomationId(&raw_id);
  element->get_CurrentClassName(&raw_class);
  element->get_CurrentFrameworkId(&raw_framework);
  element->get_CurrentControlType(&control_type);
  element->get_CurrentNativeWindowHandle(&native_window);
  element->get_CurrentIsEnabled(&enabled);
  element->get_CurrentIsOffscreen(&offscreen);
  element->get_CurrentHasKeyboardFocus(&focused);
  element->get_CurrentIsPassword(&password);
  element->get_CurrentBoundingRectangle(&rect);
  napi_value result;
  napi_create_object(env, &result);
  SetNamed(env, result, "ref", StringValue(env, RuntimeRef(element)));
  SetNamed(env, result, "type", StringValue(env, ControlTypeName(control_type)));
  const std::wstring name = ReadBstr(raw_name);
  const std::wstring automation_id = ReadBstr(raw_id, 100);
  const std::wstring class_name = ReadBstr(raw_class, 100);
  const std::wstring framework = ReadBstr(raw_framework, 60);
  if (!name.empty()) SetNamed(env, result, "name", StringValue(env, name));
  if (!automation_id.empty()) SetNamed(env, result, "id", StringValue(env, automation_id));
  if (!class_name.empty()) SetNamed(env, result, "class", StringValue(env, class_name));
  if (!framework.empty()) SetNamed(env, result, "framework", StringValue(env, framework));
  if (native_window) {
    SetNamed(env, result, "hwnd", HwndValue(env, reinterpret_cast<HWND>(native_window)));
  }
  const std::wstring current_value = password ? L"" : CurrentValue(element);
  if (!current_value.empty()) SetNamed(env, result, "value", StringValue(env, current_value));
  SetNamed(env, result, "depth", IntValue(env, depth));
  SetNamed(env, result, "x", IntValue(env, rect.left));
  SetNamed(env, result, "y", IntValue(env, rect.top));
  SetNamed(env, result, "width", IntValue(env, rect.right - rect.left));
  SetNamed(env, result, "height", IntValue(env, rect.bottom - rect.top));
  POINT clickable = {};
  BOOL has_clickable = FALSE;
  element->GetClickablePoint(&clickable, &has_clickable);
  if (!has_clickable && rect.right > rect.left && rect.bottom > rect.top) {
    clickable.x = rect.left + (rect.right - rect.left) / 2;
    clickable.y = rect.top + (rect.bottom - rect.top) / 2;
  }
  if ((has_clickable || (rect.right > rect.left && rect.bottom > rect.top))
      && PointBelongsToBoundWindow(clickable, child, expected_pid)) {
    SetNamed(env, result, "click_x", IntValue(env, clickable.x));
    SetNamed(env, result, "click_y", IntValue(env, clickable.y));
  }
  SetNamed(env, result, "enabled", BoolValue(env, enabled != FALSE));
  if (offscreen) SetNamed(env, result, "offscreen", BoolValue(env, true));
  if (focused) SetNamed(env, result, "focused", BoolValue(env, true));
  if (password) SetNamed(env, result, "password", BoolValue(env, true));
  SetNamed(env, result, "actions", ActionsValue(env, element));
  return result;
}

ComPtr<IUIAutomationElement> FindElement(
    napi_env env, IUIAutomation* automation, IUIAutomationElement* root,
    const std::wstring& ref) {
  if (ref == L"root") return root;
  const std::vector<int> values = ParseRuntimeRef(ref);
  if (values.empty()) {
    napi_throw_error(env, nullptr, "invalid or stale UI Automation ref");
    return nullptr;
  }
  SAFEARRAY* ids = SafeArrayCreateVector(VT_I4, 0, values.size());
  for (LONG index = 0; index < static_cast<LONG>(values.size()); ++index) {
    int value = values[index];
    SafeArrayPutElement(ids, &index, &value);
  }
  VARIANT variant;
  VariantInit(&variant);
  variant.vt = VT_ARRAY | VT_I4;
  variant.parray = ids;
  ComPtr<IUIAutomationCondition> condition;
  HRESULT result = automation->CreatePropertyCondition(
      UIA_RuntimeIdPropertyId, variant, &condition);
  VariantClear(&variant);
  if (FAILED(result)) {
    ThrowHresult(env, "CreatePropertyCondition(RuntimeId)", result);
    return nullptr;
  }
  ComPtr<IUIAutomationElement> found;
  result = root->FindFirst(TreeScope_Subtree, condition.Get(), &found);
  if (FAILED(result) || !found) {
    napi_throw_error(env, nullptr, "UI element ref is stale; observe again");
    return nullptr;
  }
  return found;
}

bool IsMouseAction(const std::wstring& action) {
  return action == L"click" || action == L"mouse_click"
      || action == L"double_click" || action == L"right_click";
}

bool ReadBoolean(napi_env env, napi_value object, const char* name) {
  napi_value value = GetNamed(env, object, name);
  bool result = false;
  if (value) napi_get_value_bool(env, value, &result);
  return result;
}

bool EnsureActionSucceeded(
    napi_env env, const UiAutomationActionResult& result) {
  if (SUCCEEDED(result.result)) return true;
  if (result.result == E_ACCESSDENIED) {
    napi_throw_error(
        env, nullptr,
        "mouse click point is obscured or outside the bound software window");
  } else {
    ThrowHresult(env, "UI Automation action", result.result);
  }
  return false;
}

napi_value ActionResultValue(
    napi_env env, const UiAutomationActionResult& result,
    const std::wstring& action, const std::wstring& ref, HWND window) {
  napi_value output;
  napi_create_object(env, &output);
  SetNamed(env, output, "success", BoolValue(env, true));
  SetNamed(env, output, "action", StringValue(env, action));
  SetNamed(env, output, "ref", StringValue(env, ref.empty() ? L"root" : ref));
  SetNamed(env, output, "method", StringValue(env, result.method));
  SetNamed(env, output, "windowHwnd", HwndValue(env, window));
  if (result.has_point) {
    SetNamed(env, output, "x", IntValue(env, result.point.x));
    SetNamed(env, output, "y", IntValue(env, result.point.y));
  }
  return output;
}

}

napi_value ObserveExternalWindowUi(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  DWORD pid = static_cast<DWORD>(ReadInt32(env, options, "childPid"));
  if (!ValidateTarget(env, child, pid)) return nullptr;
  ComScope com;
  if (!com.usable()) {
    napi_throw_error(env, nullptr, "COM initialization failed");
    return nullptr;
  }
  ComPtr<IUIAutomation> automation = CreateAutomation(env);
  if (!automation) return nullptr;
  const HWND automation_window = ResolveAutomationWindow(child, pid);
  ComPtr<IUIAutomationElement> root = RootElement(
      env, automation.Get(), automation_window, pid);
  if (!root) return nullptr;
  ComPtr<IUIAutomationTreeWalker> walker;
  HRESULT result = automation->get_ControlViewWalker(&walker);
  if (FAILED(result)) {
    ThrowHresult(env, "get_ControlViewWalker", result);
    return nullptr;
  }

  const int limit = std::clamp(ReadInt32(env, options, "limit", 30), 1, 80);
  const int max_depth = std::clamp(ReadInt32(env, options, "maxDepth", 6), 1, 10);
  std::vector<UiNode> queue = { { root, 0 } };
  napi_value items;
  napi_create_array(env, &items);
  uint32_t emitted = 0;
  size_t cursor = 0;
  size_t visited = 0;
  while (cursor < queue.size() && emitted < static_cast<uint32_t>(limit)
      && visited < static_cast<size_t>(limit * 12)) {
    UiNode node = queue[cursor++];
    visited += 1;
    napi_set_element(
        env, items, emitted++,
        ElementValue(env, node.element.Get(), node.depth, child, pid));
    if (node.depth >= max_depth) continue;
    ComPtr<IUIAutomationElement> child_element;
    walker->GetFirstChildElement(node.element.Get(), &child_element);
    while (child_element && queue.size() < static_cast<size_t>(limit * 12)) {
      queue.push_back({ child_element, node.depth + 1 });
      ComPtr<IUIAutomationElement> sibling;
      walker->GetNextSiblingElement(child_element.Get(), &sibling);
      child_element = sibling;
    }
  }
  napi_value output;
  napi_create_object(env, &output);
  SetNamed(env, output, "success", BoolValue(env, true));
  SetNamed(env, output, "items", items);
  SetNamed(env, output, "count", IntValue(env, emitted));
  SetNamed(env, output, "truncated", BoolValue(env, cursor < queue.size()));
  SetNamed(env, output, "windowHwnd", HwndValue(env, automation_window));
  SetNamed(env, output, "boundWindowHwnd", HwndValue(env, child));
  SetNamed(env, output, "popup", BoolValue(env, automation_window != child));
  return output;
}

napi_value PerformExternalWindowUiAction(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  DWORD pid = static_cast<DWORD>(ReadInt32(env, options, "childPid"));
  if (!ValidateTarget(env, child, pid)) return nullptr;
  const std::wstring ref = ReadWideString(env, GetNamed(env, options, "ref"), L"root");
  const std::wstring action = ReadWideString(env, GetNamed(env, options, "action"), L"");
  const std::wstring text = ReadWideString(env, GetNamed(env, options, "text"), L"");
  const int x = ReadInt32(env, options, "x", INT_MIN);
  const int y = ReadInt32(env, options, "y", INT_MIN);
  const int end_x = ReadInt32(env, options, "endX", INT_MIN);
  const int end_y = ReadInt32(env, options, "endY", INT_MIN);
  const int delta = std::clamp(ReadInt32(env, options, "delta", 0), -1200, 1200);
  const bool direct_input = ReadBoolean(env, options, "directInput");
  const HWND automation_window = ResolveAutomationWindow(child, pid);
  if (IsMouseAction(action) && x != INT_MIN && y != INT_MIN) {
    const UiAutomationActionResult direct = PerformBoundMouseAction(
        child, pid, action, { x, y });
    return EnsureActionSucceeded(env, direct)
      ? ActionResultValue(env, direct, action, ref, automation_window)
      : nullptr;
  }
  if (action == L"type" && direct_input) {
    const UiAutomationActionResult direct = PerformBoundTextInput(
        child, pid, text);
    return EnsureActionSucceeded(env, direct)
      ? ActionResultValue(env, direct, action, ref, automation_window)
      : nullptr;
  }
  if (action == L"press_key" && direct_input) {
    const UiAutomationActionResult direct = PerformBoundKeyInput(
        child, pid, text);
    return EnsureActionSucceeded(env, direct)
      ? ActionResultValue(env, direct, action, ref, automation_window)
      : nullptr;
  }
  if (action == L"scroll" && x != INT_MIN && y != INT_MIN && delta != 0) {
    const UiAutomationActionResult direct = PerformBoundScroll(
        child, pid, { x, y }, delta);
    return EnsureActionSucceeded(env, direct)
      ? ActionResultValue(env, direct, action, ref, automation_window)
      : nullptr;
  }
  if (action == L"drag" && x != INT_MIN && y != INT_MIN
      && end_x != INT_MIN && end_y != INT_MIN) {
    const UiAutomationActionResult direct = PerformBoundDrag(
        child, pid, { x, y }, { end_x, end_y });
    return EnsureActionSucceeded(env, direct)
      ? ActionResultValue(env, direct, action, ref, automation_window)
      : nullptr;
  }
  ComScope com;
  if (!com.usable()) {
    napi_throw_error(env, nullptr, "COM initialization failed");
    return nullptr;
  }
  ComPtr<IUIAutomation> automation = CreateAutomation(env);
  if (!automation) return nullptr;
  ComPtr<IUIAutomationElement> root = RootElement(
      env, automation.Get(), automation_window, pid);
  if (!root) return nullptr;
  ComPtr<IUIAutomationElement> element = FindElement(
      env, automation.Get(), root.Get(), ref.empty() ? L"root" : ref);
  if (!element) return nullptr;
  const UiAutomationActionResult result = PerformUiAutomationAction(
      element.Get(), action, text, child, pid);
  return EnsureActionSucceeded(env, result)
    ? ActionResultValue(env, result, action, ref, automation_window)
    : nullptr;
}

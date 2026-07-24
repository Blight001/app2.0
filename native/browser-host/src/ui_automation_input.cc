#include "ui_automation_input.h"

#include <ole2.h>
#include <wrl/client.h>

#include <vector>

using Microsoft::WRL::ComPtr;

namespace {
template <typename Pattern>
ComPtr<Pattern> CurrentPattern(IUIAutomationElement* element, PATTERNID id) {
  ComPtr<Pattern> pattern;
  element->GetCurrentPatternAs(id, __uuidof(Pattern), &pattern);
  return pattern;
}

HRESULT InvokeElement(IUIAutomationElement* element) {
  if (auto pattern = CurrentPattern<IUIAutomationInvokePattern>(
      element, UIA_InvokePatternId)) return pattern->Invoke();
  if (auto pattern = CurrentPattern<IUIAutomationSelectionItemPattern>(
      element, UIA_SelectionItemPatternId)) return pattern->Select();
  if (auto pattern = CurrentPattern<IUIAutomationLegacyIAccessiblePattern>(
      element, UIA_LegacyIAccessiblePatternId)) return pattern->DoDefaultAction();
  return UIA_E_NOTSUPPORTED;
}

HRESULT SetElementValue(IUIAutomationElement* element, const std::wstring& text) {
  auto pattern = CurrentPattern<IUIAutomationValuePattern>(element, UIA_ValuePatternId);
  if (!pattern) return UIA_E_NOTSUPPORTED;
  BSTR value = SysAllocStringLen(text.data(), static_cast<UINT>(text.size()));
  if (!value && !text.empty()) return E_OUTOFMEMORY;
  const HRESULT result = pattern->SetValue(value);
  SysFreeString(value);
  return result;
}

bool ResolveClickPoint(IUIAutomationElement* element, POINT* point) {
  BOOL clickable = FALSE;
  if (SUCCEEDED(element->GetClickablePoint(point, &clickable)) && clickable) return true;
  RECT rect = {};
  if (FAILED(element->get_CurrentBoundingRectangle(&rect))
      || rect.right <= rect.left || rect.bottom <= rect.top) return false;
  point->x = rect.left + (rect.right - rect.left) / 2;
  point->y = rect.top + (rect.bottom - rect.top) / 2;
  return true;
}

bool IsBoundWindowOrOwnedPopup(HWND window, HWND bound_window) {
  for (HWND current = window; current; current = GetParent(current)) {
    if (current == bound_window) return true;
  }
  HWND current = GetAncestor(window, GA_ROOT);
  for (int depth = 0; current && depth < 16; ++depth) {
    if (current == bound_window) return true;
    current = GetWindow(current, GW_OWNER);
  }
  return false;
}

bool PointBelongsToTarget(POINT point, HWND bound_window, DWORD expected_pid) {
  const HWND hit = WindowFromPoint(point);
  if (!IsWindow(hit)) return false;
  DWORD actual_pid = 0;
  GetWindowThreadProcessId(hit, &actual_pid);
  return actual_pid == expected_pid && IsBoundWindowOrOwnedPopup(hit, bound_window);
}

bool TargetOwnsKeyboardFocus(HWND bound_window, DWORD expected_pid) {
  DWORD target_thread = GetWindowThreadProcessId(bound_window, nullptr);
  GUITHREADINFO info = { sizeof(info) };
  if (!target_thread || !GetGUIThreadInfo(target_thread, &info)) return false;
  HWND focused = info.hwndFocus ? info.hwndFocus : info.hwndActive;
  if (!focused) return false;
  DWORD actual_pid = 0;
  GetWindowThreadProcessId(focused, &actual_pid);
  return actual_pid == expected_pid
      && IsBoundWindowOrOwnedPopup(focused, bound_window);
}

HRESULT SendInputs(const std::vector<INPUT>& inputs) {
  if (inputs.empty()) return S_OK;
  const UINT sent = SendInput(
      static_cast<UINT>(inputs.size()),
      const_cast<INPUT*>(inputs.data()), sizeof(INPUT));
  return sent == inputs.size()
    ? S_OK
    : HRESULT_FROM_WIN32(GetLastError());
}

WORD NamedVirtualKey(const std::wstring& key) {
  if (key == L"Enter") return VK_RETURN;
  if (key == L"Tab") return VK_TAB;
  if (key == L"Escape" || key == L"Esc") return VK_ESCAPE;
  if (key == L"Backspace") return VK_BACK;
  if (key == L"Delete") return VK_DELETE;
  if (key == L"ArrowLeft") return VK_LEFT;
  if (key == L"ArrowRight") return VK_RIGHT;
  if (key == L"ArrowUp") return VK_UP;
  if (key == L"ArrowDown") return VK_DOWN;
  if (key == L"Home") return VK_HOME;
  if (key == L"End") return VK_END;
  if (key == L"PageUp") return VK_PRIOR;
  if (key == L"PageDown") return VK_NEXT;
  if (key == L"Space") return VK_SPACE;
  return 0;
}

bool ResolveVirtualKey(
    const std::wstring& key, WORD* virtual_key, BYTE* modifiers) {
  *virtual_key = NamedVirtualKey(key);
  *modifiers = 0;
  if (*virtual_key) return true;
  if (key.size() == 1) {
    const SHORT mapped = VkKeyScanW(key[0]);
    if (mapped == -1) return false;
    *virtual_key = LOBYTE(mapped);
    *modifiers = HIBYTE(mapped);
    return *virtual_key != 0;
  }
  return false;
}

void AppendKeyInput(std::vector<INPUT>* inputs, WORD virtual_key, bool key_up) {
  INPUT input = {};
  input.type = INPUT_KEYBOARD;
  input.ki.wVk = virtual_key;
  input.ki.dwFlags = key_up ? KEYEVENTF_KEYUP : 0;
  inputs->push_back(input);
}

HRESULT SendMouseAtPoint(
    HWND bound_window, DWORD expected_pid,
    const std::wstring& action, POINT point) {
  if (!PointBelongsToTarget(point, bound_window, expected_pid)) return E_ACCESSDENIED;
  POINT original = {};
  const bool restore_cursor = GetCursorPos(&original) != FALSE;
  if (!SetCursorPos(point.x, point.y)) return HRESULT_FROM_WIN32(GetLastError());
  const bool right = action == L"right_click";
  const int clicks = action == L"double_click" ? 2 : 1;
  const DWORD down = right ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_LEFTDOWN;
  const DWORD up = right ? MOUSEEVENTF_RIGHTUP : MOUSEEVENTF_LEFTUP;
  HRESULT result = S_OK;
  for (int index = 0; index < clicks; ++index) {
    INPUT inputs[2] = {};
    inputs[0].type = INPUT_MOUSE;
    inputs[0].mi.dwFlags = down;
    inputs[1].type = INPUT_MOUSE;
    inputs[1].mi.dwFlags = up;
    if (SendInput(2, inputs, sizeof(INPUT)) != 2) {
      result = HRESULT_FROM_WIN32(GetLastError());
      break;
    }
    if (clicks > 1 && index == 0) Sleep(40);
  }
  if (restore_cursor) SetCursorPos(original.x, original.y);
  return result;
}

HRESULT SendScrollAtPoint(
    HWND bound_window, DWORD expected_pid, POINT point, int delta) {
  if (!PointBelongsToTarget(point, bound_window, expected_pid)) return E_ACCESSDENIED;
  POINT original = {};
  const bool restore_cursor = GetCursorPos(&original) != FALSE;
  if (!SetCursorPos(point.x, point.y)) return HRESULT_FROM_WIN32(GetLastError());
  INPUT input = {};
  input.type = INPUT_MOUSE;
  input.mi.dwFlags = MOUSEEVENTF_WHEEL;
  input.mi.mouseData = static_cast<DWORD>(delta);
  const HRESULT result = SendInput(1, &input, sizeof(INPUT)) == 1
    ? S_OK : HRESULT_FROM_WIN32(GetLastError());
  if (restore_cursor) SetCursorPos(original.x, original.y);
  return result;
}

HRESULT SendDragBetweenPoints(
    HWND bound_window, DWORD expected_pid, POINT start, POINT end) {
  if (!PointBelongsToTarget(start, bound_window, expected_pid)
      || !PointBelongsToTarget(end, bound_window, expected_pid)) return E_ACCESSDENIED;
  POINT original = {};
  const bool restore_cursor = GetCursorPos(&original) != FALSE;
  if (!SetCursorPos(start.x, start.y)) return HRESULT_FROM_WIN32(GetLastError());
  INPUT down = {};
  down.type = INPUT_MOUSE;
  down.mi.dwFlags = MOUSEEVENTF_LEFTDOWN;
  if (SendInput(1, &down, sizeof(INPUT)) != 1) {
    return HRESULT_FROM_WIN32(GetLastError());
  }
  for (int step = 1; step <= 8; ++step) {
    SetCursorPos(
        start.x + (end.x - start.x) * step / 8,
        start.y + (end.y - start.y) * step / 8);
    Sleep(8);
  }
  INPUT up = {};
  up.type = INPUT_MOUSE;
  up.mi.dwFlags = MOUSEEVENTF_LEFTUP;
  const HRESULT result = SendInput(1, &up, sizeof(INPUT)) == 1
    ? S_OK : HRESULT_FROM_WIN32(GetLastError());
  if (restore_cursor) SetCursorPos(original.x, original.y);
  return result;
}

HRESULT SendMouseClick(
    IUIAutomationElement* element, HWND bound_window, DWORD expected_pid,
    const std::wstring& action, POINT* used_point) {
  POINT point = {};
  if (!ResolveClickPoint(element, &point)) return UIA_E_NOTSUPPORTED;
  const HRESULT result = SendMouseAtPoint(
      bound_window, expected_pid, action, point);
  *used_point = point;
  return result;
}

void PerformPatternAction(
    IUIAutomationElement* element, const std::wstring& action,
    UiAutomationActionResult* output) {
  if (action == L"toggle") {
    auto pattern = CurrentPattern<IUIAutomationTogglePattern>(
        element, UIA_TogglePatternId);
    output->result = pattern ? pattern->Toggle() : UIA_E_NOTSUPPORTED;
  } else if (action == L"select") {
    auto pattern = CurrentPattern<IUIAutomationSelectionItemPattern>(
        element, UIA_SelectionItemPatternId);
    output->result = pattern ? pattern->Select() : UIA_E_NOTSUPPORTED;
  } else if (action == L"expand" || action == L"collapse") {
    auto pattern = CurrentPattern<IUIAutomationExpandCollapsePattern>(
        element, UIA_ExpandCollapsePatternId);
    output->result = action == L"expand"
      ? (pattern ? pattern->Expand() : UIA_E_NOTSUPPORTED)
      : (pattern ? pattern->Collapse() : UIA_E_NOTSUPPORTED);
  }
}
}

UiAutomationActionResult PerformUiAutomationAction(
    IUIAutomationElement* element, const std::wstring& action,
    const std::wstring& text, HWND bound_window, DWORD expected_pid) {
  UiAutomationActionResult output = { E_INVALIDARG, L"uia", {}, false };
  if (action == L"focus") output.result = element->SetFocus();
  else if (action == L"invoke") output.result = InvokeElement(element);
  else if (action == L"click" || action == L"mouse_click" || action == L"double_click"
      || action == L"right_click") {
    output.result = SendMouseClick(
        element, bound_window, expected_pid, action, &output.point);
    output.method = L"mouse";
    output.has_point = SUCCEEDED(output.result);
  } else if (action == L"set_value" || action == L"type") {
    output.result = SetElementValue(element, text);
  } else {
    PerformPatternAction(element, action, &output);
  }
  return output;
}

UiAutomationActionResult PerformBoundMouseAction(
    HWND bound_window, DWORD expected_pid,
    const std::wstring& action, POINT point) {
  UiAutomationActionResult output = { E_INVALIDARG, L"mouse", point, false };
  output.result = SendMouseAtPoint(
      bound_window, expected_pid, action, point);
  output.has_point = SUCCEEDED(output.result);
  return output;
}

UiAutomationActionResult PerformBoundTextInput(
    HWND bound_window, DWORD expected_pid, const std::wstring& text) {
  UiAutomationActionResult output = { E_ACCESSDENIED, L"keyboard", {}, false };
  if (!TargetOwnsKeyboardFocus(bound_window, expected_pid)) return output;
  std::vector<INPUT> inputs;
  inputs.reserve(text.size() * 2);
  for (const wchar_t character : text) {
    INPUT down = {};
    down.type = INPUT_KEYBOARD;
    down.ki.wScan = character;
    down.ki.dwFlags = KEYEVENTF_UNICODE;
    INPUT up = down;
    up.ki.dwFlags |= KEYEVENTF_KEYUP;
    inputs.push_back(down);
    inputs.push_back(up);
  }
  output.result = SendInputs(inputs);
  return output;
}

UiAutomationActionResult PerformBoundKeyInput(
    HWND bound_window, DWORD expected_pid, const std::wstring& key) {
  UiAutomationActionResult output = { E_INVALIDARG, L"keyboard", {}, false };
  if (!TargetOwnsKeyboardFocus(bound_window, expected_pid)) {
    output.result = E_ACCESSDENIED;
    return output;
  }
  WORD virtual_key = 0;
  BYTE modifiers = 0;
  if (!ResolveVirtualKey(key, &virtual_key, &modifiers)) return output;
  std::vector<INPUT> inputs;
  inputs.reserve(8);
  if (modifiers & 2) AppendKeyInput(&inputs, VK_CONTROL, false);
  if (modifiers & 4) AppendKeyInput(&inputs, VK_MENU, false);
  if (modifiers & 1) AppendKeyInput(&inputs, VK_SHIFT, false);
  AppendKeyInput(&inputs, virtual_key, false);
  AppendKeyInput(&inputs, virtual_key, true);
  if (modifiers & 1) AppendKeyInput(&inputs, VK_SHIFT, true);
  if (modifiers & 4) AppendKeyInput(&inputs, VK_MENU, true);
  if (modifiers & 2) AppendKeyInput(&inputs, VK_CONTROL, true);
  output.result = SendInputs(inputs);
  return output;
}

UiAutomationActionResult PerformBoundScroll(
    HWND bound_window, DWORD expected_pid, POINT point, int delta) {
  UiAutomationActionResult output = { E_INVALIDARG, L"mouse", point, false };
  output.result = SendScrollAtPoint(
      bound_window, expected_pid, point, delta);
  output.has_point = SUCCEEDED(output.result);
  return output;
}

UiAutomationActionResult PerformBoundDrag(
    HWND bound_window, DWORD expected_pid, POINT start, POINT end) {
  UiAutomationActionResult output = { E_INVALIDARG, L"mouse", end, false };
  output.result = SendDragBetweenPoints(
      bound_window, expected_pid, start, end);
  output.has_point = SUCCEEDED(output.result);
  return output;
}

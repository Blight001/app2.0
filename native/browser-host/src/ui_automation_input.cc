#include "ui_automation_input.h"

#include <ole2.h>
#include <wrl/client.h>

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
  output.result = SendMouseAtPoint(bound_window, expected_pid, action, point);
  output.has_point = SUCCEEDED(output.result);
  return output;
}

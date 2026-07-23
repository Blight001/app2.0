#pragma once

#include <windows.h>
#include <ole2.h>
#include <UIAutomation.h>

#include <string>

struct UiAutomationActionResult {
  HRESULT result;
  const wchar_t* method;
  POINT point;
  bool has_point;
};

UiAutomationActionResult PerformUiAutomationAction(
    IUIAutomationElement* element, const std::wstring& action,
    const std::wstring& text, HWND bound_window, DWORD expected_pid);

UiAutomationActionResult PerformBoundMouseAction(
    HWND bound_window, DWORD expected_pid,
    const std::wstring& action, POINT point);

UiAutomationActionResult PerformBoundTextInput(
    HWND bound_window, DWORD expected_pid, const std::wstring& text);

UiAutomationActionResult PerformBoundKeyInput(
    HWND bound_window, DWORD expected_pid, const std::wstring& key);

UiAutomationActionResult PerformBoundScroll(
    HWND bound_window, DWORD expected_pid, POINT point, int delta);

UiAutomationActionResult PerformBoundDrag(
    HWND bound_window, DWORD expected_pid, POINT start, POINT end);

#pragma once

#include <windows.h>
#include <string>

struct SoftwareInputResult {
  HRESULT result;
  const wchar_t* method;
  POINT point;
  bool has_point;
};

SoftwareInputResult PerformBoundMouseAction(
    HWND bound_window, DWORD expected_pid,
    const std::wstring& action, POINT point);

SoftwareInputResult PerformBoundTextInput(
    HWND bound_window, DWORD expected_pid, const std::wstring& text);

SoftwareInputResult PerformBoundKeyInput(
    HWND bound_window, DWORD expected_pid, const std::wstring& key);

SoftwareInputResult PerformBoundScroll(
    HWND bound_window, DWORD expected_pid, POINT point, int delta);

SoftwareInputResult PerformBoundDrag(
    HWND bound_window, DWORD expected_pid, POINT start, POINT end);

SoftwareInputResult FocusBoundWindow(
    HWND bound_window, DWORD expected_pid);

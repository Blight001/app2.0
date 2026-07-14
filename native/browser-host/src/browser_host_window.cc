#include "browser_host_window.h"
#include "native_helpers.h"
#include <dwmapi.h>

namespace {
const wchar_t* kHostWindowClass = L"AIFreeBrowserHostWindow";
constexpr UINT_PTR kVisualSyncTimerFast = 0xA1F1;
constexpr UINT_PTR kVisualSyncTimerMedium = 0xA1F2;
constexpr UINT_PTR kVisualSyncTimerSettled = 0xA1F3;

void ResizeHostedChild(HWND hwnd) {
  HWND child = GetWindow(hwnd, GW_CHILD);
  if (!IsWindow(child)) return;
  RECT rect = {};
  GetClientRect(hwnd, &rect);
  const int width = rect.right > rect.left ? rect.right - rect.left : 0;
  const int height = rect.bottom > rect.top ? rect.bottom - rect.top : 0;
  SetWindowPos(child, HWND_TOP, 0, 0,
      width, height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW);
}

void ReassertHostVisualState(HWND hwnd) {
  if (!IsWindow(hwnd) || !IsWindowVisible(hwnd)) return;
  // Electron owns sibling renderer HWNDs and may reorder them after a
  // BrowserView/layout update. Always put the native host back above those
  // siblings, then size and raise Chromium inside the host.
  SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  ResizeHostedChild(hwnd);
  RedrawWindow(hwnd, nullptr, nullptr,
      RDW_INVALIDATE | RDW_FRAME | RDW_ALLCHILDREN | RDW_UPDATENOW);
  DwmFlush();
}

void ScheduleVisualSync(HWND hwnd) {
  // Cover the immediate attach, Electron's next layout pass, and the first
  // compositor frame without keeping a permanent polling timer alive.
  SetTimer(hwnd, kVisualSyncTimerFast, 16, nullptr);
  SetTimer(hwnd, kVisualSyncTimerMedium, 80, nullptr);
  SetTimer(hwnd, kVisualSyncTimerSettled, 240, nullptr);
}

LRESULT CALLBACK HostWindowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_ERASEBKGND: {
      RECT rect;
      GetClientRect(hwnd, &rect);
      FillRect(reinterpret_cast<HDC>(wparam), &rect, reinterpret_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
      return 1;
    }
    case WM_SIZE: {
      ResizeHostedChild(hwnd);
      return 0;
    }
    case WM_SHOWWINDOW:
      if (wparam) ScheduleVisualSync(hwnd);
      return DefWindowProc(hwnd, message, wparam, lparam);
    case WM_TIMER:
      if (wparam == kVisualSyncTimerFast ||
          wparam == kVisualSyncTimerMedium ||
          wparam == kVisualSyncTimerSettled) {
        KillTimer(hwnd, static_cast<UINT_PTR>(wparam));
        ReassertHostVisualState(hwnd);
        return 0;
      }
      break;
    case WM_DESTROY:
      KillTimer(hwnd, kVisualSyncTimerFast);
      KillTimer(hwnd, kVisualSyncTimerMedium);
      KillTimer(hwnd, kVisualSyncTimerSettled);
      break;
  }
  return DefWindowProc(hwnd, message, wparam, lparam);
}

bool EnsureHostClass() {
  static bool registered = false;
  if (registered) return true;
  WNDCLASSEXW wc = {};
  wc.cbSize = sizeof(wc);
  wc.lpfnWndProc = HostWindowProc;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  wc.hbrBackground = reinterpret_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
  wc.lpszClassName = kHostWindowClass;
  registered = RegisterClassExW(&wc) != 0 || GetLastError() == ERROR_CLASS_ALREADY_EXISTS;
  return registered;
}
}

napi_value CreateHostWindow(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  if (!options) return nullptr;
  HWND parent = ReadHwnd(env, GetNamed(env, options, "parentHwnd"));
  if (!IsWindow(parent)) {
    napi_throw_error(env, nullptr, "parentHwnd is not a live window");
    return nullptr;
  }
  if (!EnsureHostClass()) {
    ThrowLastError(env, "RegisterClassExW");
    return nullptr;
  }
  int x = ReadInt32(env, options, "x");
  int y = ReadInt32(env, options, "y");
  int width = ReadInt32(env, options, "width");
  int height = ReadInt32(env, options, "height");
  HWND hwnd = CreateWindowExW(
      WS_EX_NOPARENTNOTIFY,
      kHostWindowClass,
      L"AI-FREE",
      // Keep the black host hidden until Chromium is attached and has been
      // synchronously sized. This avoids exposing an empty black rectangle
      // during the runtime handshake.
      WS_CHILD | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
      x, y, width, height,
      parent, nullptr, GetModuleHandleW(nullptr), nullptr);
  if (!hwnd) {
    ThrowLastError(env, "CreateWindowExW");
    return nullptr;
  }
  return HwndValue(env, hwnd);
}

napi_value DestroyHostWindow(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND hwnd = ReadHwnd(env, GetNamed(env, options, "hostHwnd"));
  return BoolValue(env, !IsWindow(hwnd) || DestroyWindow(hwnd) != FALSE);
}

napi_value SetHostBounds(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND hwnd = ReadHwnd(env, GetNamed(env, options, "hostHwnd"));
  if (!IsWindow(hwnd)) return BoolValue(env, false);
  // Electron's renderer owns a sibling Chrome_RenderWidgetHostHWND that spans
  // the whole client area. Keeping SWP_NOZORDER here leaves this native host
  // behind that renderer, so the attached Chromium window is alive but the
  // user only sees Electron's black background. Raise the host whenever its
  // bounds are synchronized.
  const bool visible = IsWindowVisible(hwnd) != FALSE;
  bool ok = SetWindowPos(hwnd, visible ? HWND_TOP : nullptr,
      ReadInt32(env, options, "x"), ReadInt32(env, options, "y"),
      ReadInt32(env, options, "width"), ReadInt32(env, options, "height"),
      SWP_NOACTIVATE | (visible ? SWP_SHOWWINDOW : SWP_NOZORDER)) != FALSE;
  if (ok && visible) {
    ReassertHostVisualState(hwnd);
    ScheduleVisualSync(hwnd);
  }
  return BoolValue(env, ok);
}

static napi_value SetHostVisibility(napi_env env, napi_callback_info info, int command) {
  napi_value options = SingleObjectArg(env, info);
  HWND hwnd = ReadHwnd(env, GetNamed(env, options, "hostHwnd"));
  if (!IsWindow(hwnd)) return BoolValue(env, false);
  ShowWindow(hwnd, command);
  return BoolValue(env, true);
}

napi_value ShowHostWindow(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND hwnd = ReadHwnd(env, GetNamed(env, options, "hostHwnd"));
  if (!IsWindow(hwnd)) return BoolValue(env, false);
  ShowWindow(hwnd, SW_SHOWNOACTIVATE);
  const bool ok = SetWindowPos(hwnd, HWND_TOP, 0, 0, 0, 0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW) != FALSE;
  if (ok) {
    ReassertHostVisualState(hwnd);
    ScheduleVisualSync(hwnd);
  }
  return BoolValue(env, ok);
}
napi_value HideHostWindow(napi_env env, napi_callback_info info) { return SetHostVisibility(env, info, SW_HIDE); }

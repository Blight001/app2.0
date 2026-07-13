#include "browser_host_window.h"
#include "native_helpers.h"

namespace {
const wchar_t* kHostWindowClass = L"AIFreeBrowserHostWindow";

LRESULT CALLBACK HostWindowProc(HWND hwnd, UINT message, WPARAM wparam, LPARAM lparam) {
  switch (message) {
    case WM_ERASEBKGND: {
      RECT rect;
      GetClientRect(hwnd, &rect);
      FillRect(reinterpret_cast<HDC>(wparam), &rect, reinterpret_cast<HBRUSH>(GetStockObject(BLACK_BRUSH)));
      return 1;
    }
    case WM_SIZE: {
      HWND child = GetWindow(hwnd, GW_CHILD);
      if (child) SetWindowPos(child, nullptr, 0, 0, LOWORD(lparam), HIWORD(lparam), SWP_NOACTIVATE | SWP_NOZORDER | SWP_ASYNCWINDOWPOS);
      return 0;
    }
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
      WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS,
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
  bool ok = SetWindowPos(hwnd, HWND_TOP,
      ReadInt32(env, options, "x"), ReadInt32(env, options, "y"),
      ReadInt32(env, options, "width"), ReadInt32(env, options, "height"),
      SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_ASYNCWINDOWPOS) != FALSE;
  if (ok) {
    InvalidateRect(hwnd, nullptr, FALSE);
    UpdateWindow(hwnd);
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
    RedrawWindow(hwnd, nullptr, nullptr,
        RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_UPDATENOW);
  }
  return BoolValue(env, ok);
}
napi_value HideHostWindow(napi_env env, napi_callback_info info) { return SetHostVisibility(env, info, SW_HIDE); }

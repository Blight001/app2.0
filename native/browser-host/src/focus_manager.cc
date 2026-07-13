#include "native_helpers.h"

namespace {

bool FocusAcrossInputQueues(HWND child) {
  // Focus the Aura browser window, not Chrome_RenderWidgetHostHWND directly.
  // Aura must own the focus transition so it can synchronize its internal
  // FocusManager before forwarding keyboard events to Blink.
  HWND target = child;

  DWORD target_process = 0;
  const DWORD target_thread =
      GetWindowThreadProcessId(target, &target_process);
  const DWORD current_thread = GetCurrentThreadId();
  HWND foreground = GetForegroundWindow();
  const DWORD foreground_thread = foreground
      ? GetWindowThreadProcessId(foreground, nullptr)
      : 0;

  const bool attached_target = target_thread != 0 &&
      target_thread != current_thread &&
      AttachThreadInput(current_thread, target_thread, TRUE) != FALSE;
  const bool attached_foreground = foreground_thread != 0 &&
      foreground_thread != current_thread &&
      foreground_thread != target_thread &&
      AttachThreadInput(current_thread, foreground_thread, TRUE) != FALSE;

  HWND root = GetAncestor(child, GA_ROOT);
  if (root) {
    SetForegroundWindow(root);
  }
  SetFocus(target);

  GUITHREADINFO info = {};
  info.cbSize = sizeof(info);
  const bool focused = target_thread != 0 &&
      GetGUIThreadInfo(target_thread, &info) != FALSE &&
      (info.hwndFocus == target || IsChild(child, info.hwndFocus));

  if (attached_foreground) {
    AttachThreadInput(current_thread, foreground_thread, FALSE);
  }
  if (attached_target) {
    AttachThreadInput(current_thread, target_thread, FALSE);
  }
  return focused;
}

}  // namespace

napi_value FocusChildWindow(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  if (!IsWindow(child)) return BoolValue(env, false);
  ShowWindow(child, SW_SHOW);
  return BoolValue(env, FocusAcrossInputQueues(child));
}

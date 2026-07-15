#include "mouse_click_monitor.h"
#include "native_helpers.h"

#include <mutex>
#include <unordered_map>

namespace {

std::mutex watchers_mutex;
std::unordered_map<HWND, napi_threadsafe_function> watchers;
HHOOK mouse_hook = nullptr;

void CallJavascript(napi_env env,
                    napi_value callback,
                    void* context,
                    void* data) {
  if (!env || !callback) return;
  napi_value undefined;
  napi_get_undefined(env, &undefined);
  napi_call_function(env, undefined, callback, 0, nullptr, nullptr);
}

LRESULT CALLBACK LowLevelMouseProc(int code, WPARAM wparam, LPARAM lparam) {
  if (code == HC_ACTION && wparam == WM_LBUTTONDOWN && lparam) {
    const auto* mouse = reinterpret_cast<const MSLLHOOKSTRUCT*>(lparam);
    const HWND hit = WindowFromPoint(mouse->pt);
    if (hit) {
      std::lock_guard<std::mutex> lock(watchers_mutex);
      for (const auto& entry : watchers) {
        const HWND child = entry.first;
        if (!IsWindow(child) || !IsWindowVisible(child)) continue;
        if (hit == child || IsChild(child, hit)) {
          napi_call_threadsafe_function(
              entry.second, nullptr, napi_tsfn_nonblocking);
          break;
        }
      }
    }
  }
  return CallNextHookEx(mouse_hook, code, wparam, lparam);
}

bool EnsureMouseHook() {
  if (mouse_hook) return true;
  HMODULE module = nullptr;
  GetModuleHandleExW(
      GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS |
          GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
      reinterpret_cast<LPCWSTR>(&LowLevelMouseProc), &module);
  mouse_hook = SetWindowsHookExW(WH_MOUSE_LL, LowLevelMouseProc, module, 0);
  return mouse_hook != nullptr;
}

void RemoveMouseHookIfUnused() {
  if (!watchers.empty() || !mouse_hook) return;
  UnhookWindowsHookEx(mouse_hook);
  mouse_hook = nullptr;
}

}  // namespace

napi_value WatchChildWindowClicks(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2] = {};
  napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc < 2) {
    napi_throw_type_error(env, nullptr, "Expected options and callback");
    return nullptr;
  }

  HWND child = ReadHwnd(env, GetNamed(env, args[0], "childHwnd"));
  napi_valuetype callback_type = napi_undefined;
  napi_typeof(env, args[1], &callback_type);
  if (!IsWindow(child) || callback_type != napi_function) {
    napi_throw_type_error(env, nullptr, "Expected a live childHwnd and callback");
    return nullptr;
  }

  napi_value resource_name;
  napi_create_string_utf8(
      env, "AI-FREE Chromium click monitor", NAPI_AUTO_LENGTH, &resource_name);
  napi_threadsafe_function callback = nullptr;
  if (napi_create_threadsafe_function(
          env, args[1], nullptr, resource_name, 0, 1,
          nullptr, nullptr, nullptr, CallJavascript, &callback) != napi_ok) {
    napi_throw_error(env, nullptr, "Could not create browser click callback");
    return nullptr;
  }
  napi_unref_threadsafe_function(env, callback);

  napi_threadsafe_function previous = nullptr;
  {
    std::lock_guard<std::mutex> lock(watchers_mutex);
    if (!EnsureMouseHook()) {
      napi_release_threadsafe_function(callback, napi_tsfn_release);
      ThrowLastError(env, "SetWindowsHookExW(WH_MOUSE_LL)");
      return nullptr;
    }
    const auto existing = watchers.find(child);
    if (existing != watchers.end()) previous = existing->second;
    watchers[child] = callback;
  }
  if (previous) {
    napi_release_threadsafe_function(previous, napi_tsfn_release);
  }
  return BoolValue(env, true);
}

napi_value UnwatchChildWindowClicks(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  napi_threadsafe_function callback = nullptr;
  {
    std::lock_guard<std::mutex> lock(watchers_mutex);
    const auto existing = watchers.find(child);
    if (existing != watchers.end()) {
      callback = existing->second;
      watchers.erase(existing);
    }
    RemoveMouseHookIfUnused();
  }
  if (callback) {
    napi_release_threadsafe_function(callback, napi_tsfn_release);
  }
  return BoolValue(env, callback != nullptr);
}

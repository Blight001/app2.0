#include "external_window_dock.h"
#include "dpi_manager.h"
#include "native_helpers.h"

#include <mutex>
#include <unordered_map>

namespace {
struct OriginalExternalWindowState {
  HWND owner;
  RECT rect;
  WINDOWPLACEMENT placement;
  bool has_placement;
  bool visible;
};

std::unordered_map<HWND, OriginalExternalWindowState> original_states;
std::mutex states_mutex;

void SetNamed(napi_env env, napi_value object, const char* name, napi_value value) {
  napi_set_named_property(env, object, name, value);
}

napi_value Int32Value(napi_env env, int32_t value) {
  napi_value result;
  napi_create_int32(env, value, &result);
  return result;
}

bool ValidateDockTarget(
    napi_env env, HWND parent, HWND child, DWORD expected_pid) {
  if (!IsWindow(parent) || !IsWindow(child)) {
    napi_throw_error(env, nullptr, "parentHwnd or childHwnd is not a live window");
    return false;
  }
  DWORD actual_pid = 0;
  GetWindowThreadProcessId(child, &actual_pid);
  if (!expected_pid || actual_pid != expected_pid) {
    napi_throw_error(env, nullptr, "child HWND does not belong to the expected process");
    return false;
  }
  DWORD current_session = 0;
  DWORD child_session = 0;
  ProcessIdToSessionId(GetCurrentProcessId(), &current_session);
  ProcessIdToSessionId(actual_pid, &child_session);
  if (current_session != child_session) {
    napi_throw_error(env, nullptr, "cross-session window docking is forbidden");
    return false;
  }
  return true;
}

OriginalExternalWindowState CaptureOriginalState(HWND child) {
  OriginalExternalWindowState state = {};
  state.owner = GetWindow(child, GW_OWNER);
  state.visible = IsWindowVisible(child) != FALSE;
  GetWindowRect(child, &state.rect);
  state.placement.length = sizeof(WINDOWPLACEMENT);
  state.has_placement = GetWindowPlacement(child, &state.placement) != FALSE;
  return state;
}

bool RememberOriginalState(HWND child) {
  std::lock_guard<std::mutex> lock(states_mutex);
  if (original_states.count(child)) return false;
  original_states.emplace(child, CaptureOriginalState(child));
  return true;
}

bool ReadOriginalState(HWND child, OriginalExternalWindowState* state, bool erase) {
  std::lock_guard<std::mutex> lock(states_mutex);
  auto found = original_states.find(child);
  if (found == original_states.end()) return false;
  *state = found->second;
  if (erase) original_states.erase(found);
  return true;
}

UINT RestoredShowCommand(const OriginalExternalWindowState& state) {
  if (!state.has_placement) return SW_SHOWNOACTIVATE;
  if (state.placement.showCmd == SW_SHOWMAXIMIZED) return SW_SHOWMAXIMIZED;
  if (state.placement.showCmd == SW_SHOWMINIMIZED
      || state.placement.showCmd == SW_MINIMIZE
      || state.placement.showCmd == SW_SHOWMINNOACTIVE) {
    return SW_SHOWMINNOACTIVE;
  }
  return SW_SHOWNOACTIVATE;
}
}

napi_value DockExternalWindow(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  if (!options) return nullptr;
  HWND parent = ReadHwnd(env, GetNamed(env, options, "parentHwnd"));
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  DWORD expected_pid = static_cast<DWORD>(ReadInt32(env, options, "childPid"));
  if (!ValidateDockTarget(env, parent, child, expected_pid)) return nullptr;

  const bool first_dock = RememberOriginalState(child);
  if (IsIconic(child) || IsZoomed(child)) ShowWindow(child, SW_RESTORE);

  SetLastError(0);
  SetWindowLongPtrW(
      child, GWLP_HWNDPARENT, reinterpret_cast<LONG_PTR>(parent));
  if (GetLastError() != 0) {
    ThrowLastError(env, "SetWindowLongPtrW(GWLP_HWNDPARENT)");
    return nullptr;
  }

  const UINT dpi = GetWindowDpiOrDefault(parent);
  POINT origin = {
    DipToPhysicalPixel(ReadInt32(env, options, "x"), dpi),
    DipToPhysicalPixel(ReadInt32(env, options, "y"), dpi),
  };
  if (!ClientToScreen(parent, &origin)) {
    ThrowLastError(env, "ClientToScreen");
    return nullptr;
  }
  const int width = DipToPhysicalPixel(ReadInt32(env, options, "width"), dpi);
  const int height = DipToPhysicalPixel(ReadInt32(env, options, "height"), dpi);
  const bool ok = SetWindowPos(
      child, first_dock ? HWND_TOP : nullptr, origin.x, origin.y, width, height,
      SWP_NOACTIVATE | SWP_SHOWWINDOW | (first_dock ? 0 : SWP_NOZORDER)) != FALSE;
  return BoolValue(env, ok);
}

napi_value HideDockedExternalWindow(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  OriginalExternalWindowState state = {};
  if (!IsWindow(child) || !ReadOriginalState(child, &state, false)) {
    return BoolValue(env, false);
  }
  ShowWindow(child, SW_HIDE);
  return BoolValue(env, true);
}

napi_value RestoreExternalWindow(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  OriginalExternalWindowState state = {};
  if (!ReadOriginalState(child, &state, true)) return BoolValue(env, true);
  if (!IsWindow(child)) return BoolValue(env, true);

  ShowWindow(child, SW_HIDE);
  SetWindowLongPtrW(
      child, GWLP_HWNDPARENT, reinterpret_cast<LONG_PTR>(state.owner));
  SetWindowPos(
      child, nullptr, state.rect.left, state.rect.top,
      state.rect.right - state.rect.left, state.rect.bottom - state.rect.top,
      SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED);
  if (state.has_placement) {
    state.placement.length = sizeof(WINDOWPLACEMENT);
    SetWindowPlacement(child, &state.placement);
  }
  if (state.visible) ShowWindow(child, RestoredShowCommand(state));
  else ShowWindow(child, SW_HIDE);
  return BoolValue(env, true);
}

napi_value IsExternalWindowDocked(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND parent = ReadHwnd(env, GetNamed(env, options, "parentHwnd"));
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  OriginalExternalWindowState state = {};
  const bool remembered = ReadOriginalState(child, &state, false);
  return BoolValue(env, remembered && IsWindow(parent) && IsWindow(child)
      && GetWindow(child, GW_OWNER) == parent);
}

napi_value GetWindowPlacementSnapshot(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND child = ReadHwnd(env, GetNamed(env, options, "hwnd"));
  if (!IsWindow(child)) {
    napi_value null_value;
    napi_get_null(env, &null_value);
    return null_value;
  }
  RECT rect = {};
  GetWindowRect(child, &rect);
  napi_value result;
  napi_create_object(env, &result);
  SetNamed(env, result, "x", Int32Value(env, rect.left));
  SetNamed(env, result, "y", Int32Value(env, rect.top));
  SetNamed(env, result, "width", Int32Value(env, rect.right - rect.left));
  SetNamed(env, result, "height", Int32Value(env, rect.bottom - rect.top));
  SetNamed(env, result, "visible", BoolValue(env, IsWindowVisible(child) != FALSE));
  SetNamed(env, result, "minimized", BoolValue(env, IsIconic(child) != FALSE));
  SetNamed(env, result, "maximized", BoolValue(env, IsZoomed(child) != FALSE));
  SetNamed(env, result, "ownerHwnd", HwndValue(env, GetWindow(child, GW_OWNER)));
  return result;
}

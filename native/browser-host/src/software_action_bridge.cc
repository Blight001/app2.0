#include "software_action_bridge.h"
#include "software_input.h"
#include "native_helpers.h"

#include <algorithm>
#include <climits>
#include <string>

namespace {

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
    napi_throw_error(env, nullptr, "cross-session software input is forbidden");
    return false;
  }
  return true;
}

bool IsMouseAction(const std::wstring& action) {
  return action == L"click" || action == L"mouse_click"
      || action == L"double_click" || action == L"right_click";
}

bool IsKeyboardAction(const std::wstring& action) {
  return action == L"type" || action == L"press_key";
}

bool EnsureActionSucceeded(
    napi_env env, const SoftwareInputResult& result, const std::wstring& action) {
  if (SUCCEEDED(result.result) || result.result == S_FALSE) return true;
  if (result.result == E_ACCESSDENIED) {
    napi_throw_error(
        env, nullptr,
        IsKeyboardAction(action)
          ? "bound software window does not own keyboard focus"
          : "mouse click point is obscured or outside the bound software window");
  } else {
    ThrowHresult(env, "software input action", result.result);
  }
  return false;
}

napi_value ActionResultValue(
    napi_env env, const SoftwareInputResult& result,
    const std::wstring& action, HWND window) {
  napi_value output;
  napi_create_object(env, &output);
  SetNamed(env, output, "success", BoolValue(env, true));
  SetNamed(env, output, "action", StringValue(env, action));
  SetNamed(env, output, "method", StringValue(env, result.method));
  SetNamed(env, output, "windowHwnd", HwndValue(env, window));
  if (result.has_point) {
    SetNamed(env, output, "x", IntValue(env, result.point.x));
    SetNamed(env, output, "y", IntValue(env, result.point.y));
  }
  return output;
}

}

napi_value PerformExternalWindowAction(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  DWORD pid = static_cast<DWORD>(ReadInt32(env, options, "childPid"));
  if (!ValidateTarget(env, child, pid)) return nullptr;
  const std::wstring action = ReadWideString(env, GetNamed(env, options, "action"), L"");
  const std::wstring text = ReadWideString(env, GetNamed(env, options, "text"), L"");
  const int x = ReadInt32(env, options, "x", INT_MIN);
  const int y = ReadInt32(env, options, "y", INT_MIN);
  const int end_x = ReadInt32(env, options, "endX", INT_MIN);
  const int end_y = ReadInt32(env, options, "endY", INT_MIN);
  const int delta = std::clamp(ReadInt32(env, options, "delta", 0), -1200, 1200);

  SoftwareInputResult result = { E_INVALIDARG, L"unknown", {}, false };
  if (IsMouseAction(action) && x != INT_MIN && y != INT_MIN) {
    result = PerformBoundMouseAction(child, pid, action, { x, y });
  } else if (action == L"type") {
    result = PerformBoundTextInput(child, pid, text);
  } else if (action == L"press_key") {
    result = PerformBoundKeyInput(child, pid, text);
  } else if (action == L"scroll" && x != INT_MIN && y != INT_MIN && delta != 0) {
    result = PerformBoundScroll(child, pid, { x, y }, delta);
  } else if (action == L"drag" && x != INT_MIN && y != INT_MIN
      && end_x != INT_MIN && end_y != INT_MIN) {
    result = PerformBoundDrag(child, pid, { x, y }, { end_x, end_y });
  } else if (action == L"focus") {
    result = FocusBoundWindow(child, pid);
  } else {
    napi_throw_error(env, nullptr, "unsupported visual software action or missing coordinates");
    return nullptr;
  }
  return EnsureActionSucceeded(env, result, action)
    ? ActionResultValue(env, result, action, child)
    : nullptr;
}

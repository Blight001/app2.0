#include "child_window_manager.h"
#include "native_helpers.h"
#include <dwmapi.h>
#include <unordered_map>
#include <mutex>
#include <vector>

namespace {
struct OriginalWindowState {
  HWND parent;
  LONG_PTR style;
  LONG_PTR ex_style;
  bool visible;
  std::wstring title;
};
std::unordered_map<HWND, OriginalWindowState> original_states;
std::mutex states_mutex;

struct FindWindowContext { DWORD pid; HWND best; long long best_area; };
struct FindPathWindowContext { std::wstring path; HWND best; long long best_area; };
struct VisibleWindow {
  HWND hwnd;
  DWORD pid;
  std::wstring title;
  std::wstring process_name;
};
struct ListWindowContext {
  DWORD current_pid;
  DWORD current_session;
  std::vector<VisibleWindow> windows;
};

long long WindowArea(HWND hwnd) {
  RECT rect = {};
  GetWindowRect(hwnd, &rect);
  return static_cast<long long>(rect.right - rect.left) * (rect.bottom - rect.top);
}

BOOL CALLBACK FindWindowCallback(HWND hwnd, LPARAM value) {
  auto* context = reinterpret_cast<FindWindowContext*>(value);
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  if (pid != context->pid || GetWindow(hwnd, GW_OWNER) != nullptr) return TRUE;
  long long area = WindowArea(hwnd);
  if (area > context->best_area) { context->best = hwnd; context->best_area = area; }
  return TRUE;
}

std::wstring ProcessExecutablePath(DWORD pid) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return L"";
  std::wstring path(32768, L'\0');
  DWORD length = static_cast<DWORD>(path.size());
  const bool ok = QueryFullProcessImageNameW(process, 0, path.data(), &length) != FALSE;
  CloseHandle(process);
  if (!ok) return L"";
  path.resize(length);
  return path;
}

BOOL CALLBACK FindPathWindowCallback(HWND hwnd, LPARAM value) {
  auto* context = reinterpret_cast<FindPathWindowContext*>(value);
  if (GetWindow(hwnd, GW_OWNER) != nullptr || !IsWindowVisible(hwnd)) return TRUE;
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);
  const std::wstring executable = ProcessExecutablePath(pid);
  if (executable.empty() || _wcsicmp(executable.c_str(), context->path.c_str()) != 0) return TRUE;
  const long long area = WindowArea(hwnd);
  if (area > context->best_area) { context->best = hwnd; context->best_area = area; }
  return TRUE;
}

std::wstring WindowText(HWND hwnd) {
  const int length = GetWindowTextLengthW(hwnd);
  if (length <= 0 || length > 4096) return L"";
  std::wstring title(static_cast<size_t>(length) + 1, L'\0');
  const int copied = GetWindowTextW(hwnd, title.data(), static_cast<int>(title.size()));
  if (copied <= 0) return L"";
  title.resize(static_cast<size_t>(copied));
  return title;
}

std::wstring BaseName(const std::wstring& executable) {
  const size_t separator = executable.find_last_of(L"\\/");
  return separator == std::wstring::npos ? executable : executable.substr(separator + 1);
}

bool IsDesktopAppWindow(HWND hwnd, const ListWindowContext& context, DWORD* pid) {
  if (!IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER) != nullptr
      || GetAncestor(hwnd, GA_ROOT) != hwnd) return false;
  const LONG_PTR ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  if ((ex_style & (WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE)) != 0) return false;
  BOOL cloaked = FALSE;
  if (SUCCEEDED(DwmGetWindowAttribute(
          hwnd, DWMWA_CLOAKED, &cloaked, sizeof(cloaked))) && cloaked) return false;
  RECT rect = {};
  if (!GetWindowRect(hwnd, &rect)) return false;
  if (!IsIconic(hwnd)
      && (rect.right - rect.left < 64 || rect.bottom - rect.top < 64)) return false;
  GetWindowThreadProcessId(hwnd, pid);
  if (!*pid || *pid == context.current_pid) return false;
  DWORD session = 0;
  return ProcessIdToSessionId(*pid, &session) && session == context.current_session;
}

BOOL CALLBACK ListWindowCallback(HWND hwnd, LPARAM value) {
  auto* context = reinterpret_cast<ListWindowContext*>(value);
  DWORD pid = 0;
  if (!IsDesktopAppWindow(hwnd, *context, &pid)) return TRUE;
  const std::wstring title = WindowText(hwnd);
  if (title.empty()) return TRUE;
  const std::wstring process_name = BaseName(ProcessExecutablePath(pid));
  context->windows.push_back({ hwnd, pid, title, process_name });
  return context->windows.size() < 256;
}

napi_value WideStringValue(napi_env env, const std::wstring& value) {
  napi_value result;
  napi_create_string_utf16(
      env, reinterpret_cast<const char16_t*>(value.c_str()), value.size(), &result);
  return result;
}

void SetNamed(napi_env env, napi_value object, const char* name, napi_value value) {
  napi_set_named_property(env, object, name, value);
}

napi_value HwndOrNull(napi_env env, HWND hwnd) {
  if (hwnd) return HwndValue(env, hwnd);
  napi_value null_value;
  napi_get_null(env, &null_value);
  return null_value;
}

}

napi_value AttachChildWindow(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND host = ReadHwnd(env, GetNamed(env, options, "hostHwnd"));
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  DWORD expected_pid = static_cast<DWORD>(ReadInt32(env, options, "childPid"));
  if (!IsWindow(host) || !IsWindow(child)) {
    napi_throw_error(env, nullptr, "hostHwnd or childHwnd is not a live window");
    return nullptr;
  }
  DWORD actual_pid = 0;
  GetWindowThreadProcessId(child, &actual_pid);
  if (!expected_pid || actual_pid != expected_pid) {
    napi_throw_error(env, nullptr, "child HWND does not belong to the expected Chromium PID");
    return nullptr;
  }
  DWORD current_session = 0, child_session = 0;
  ProcessIdToSessionId(GetCurrentProcessId(), &current_session);
  ProcessIdToSessionId(actual_pid, &child_session);
  if (current_session != child_session) {
    napi_throw_error(env, nullptr, "cross-session window embedding is forbidden");
    return nullptr;
  }
  LONG_PTR style = GetWindowLongPtr(child, GWL_STYLE);
  LONG_PTR ex_style = GetWindowLongPtr(child, GWL_EXSTYLE);
  const bool was_visible = IsWindowVisible(child) != FALSE;
  const std::wstring original_title = WindowText(child);
  {
    std::lock_guard<std::mutex> lock(states_mutex);
    if (!original_states.count(child)) {
      original_states[child] = {
        GetParent(child), style, ex_style, was_visible, original_title
      };
    }
  }
  ShowWindow(child, SW_HIDE);
  const LONG_PTR embedded_style =
      (style & ~(WS_POPUP | WS_CAPTION | WS_THICKFRAME | WS_SYSMENU |
                 WS_MINIMIZEBOX | WS_MAXIMIZEBOX)) |
      WS_CHILD | WS_VISIBLE | WS_CLIPCHILDREN | WS_CLIPSIBLINGS;
  const LONG_PTR embedded_ex_style =
      ex_style & ~(WS_EX_APPWINDOW | WS_EX_WINDOWEDGE | WS_EX_CLIENTEDGE |
                   WS_EX_DLGMODALFRAME);
  SetWindowLongPtr(child, GWL_STYLE, embedded_style);
  SetWindowLongPtr(child, GWL_EXSTYLE, embedded_ex_style);
  SetLastError(0);
  HWND previous = SetParent(child, host);
  if (!previous && GetLastError() != 0) {
    ThrowLastError(env, "SetParent");
    return nullptr;
  }
  if (GetParent(child) != host || !IsChild(host, child)) {
    napi_throw_error(env, nullptr, "Chromium HWND was not attached to the Browser Host");
    return nullptr;
  }
  const std::wstring product_title = ReadWideString(env, GetNamed(env, options, "title"), L"AI-FREE");
  if (!product_title.empty()) SetWindowTextW(child, product_title.c_str());
  RECT rect = {};
  GetClientRect(host, &rect);
  const int width = rect.right > rect.left ? rect.right - rect.left : 0;
  const int height = rect.bottom > rect.top ? rect.bottom - rect.top : 0;
  // The first attach must be synchronous. With SWP_ASYNCWINDOWPOS the host can
  // become visible before Chromium has processed its frame/bounds change,
  // leaving the user looking at the host's black background.
  const bool ok = SetWindowPos(child, HWND_TOP, 0, 0, width, height,
      SWP_FRAMECHANGED | SWP_SHOWWINDOW | SWP_NOACTIVATE) != FALSE;
  if (ok) {
    RedrawWindow(child, nullptr, nullptr,
        RDW_INVALIDATE | RDW_FRAME | RDW_ALLCHILDREN | RDW_UPDATENOW);
    UpdateWindow(child);
    DwmFlush();
  }
  return BoolValue(env, ok);
}

napi_value SetChildWindowTitle(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  if (!IsWindow(child)) return BoolValue(env, false);
  const std::wstring title = ReadWideString(env, GetNamed(env, options, "title"), L"AI-FREE");
  return BoolValue(env, !title.empty() && SetWindowTextW(child, title.c_str()) != FALSE);
}

napi_value IsChildWindowAttached(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND host = ReadHwnd(env, GetNamed(env, options, "hostHwnd"));
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  return BoolValue(env, IsWindow(host) && IsWindow(child)
      && GetParent(child) == host && IsChild(host, child));
}

napi_value DetachChildWindow(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  if (!IsWindow(child)) return BoolValue(env, true);
  OriginalWindowState original = {};
  bool found = false;
  {
    std::lock_guard<std::mutex> lock(states_mutex);
    auto it = original_states.find(child);
    if (it != original_states.end()) { original = it->second; original_states.erase(it); found = true; }
  }
  ShowWindow(child, SW_HIDE);
  if (found) {
    SetWindowLongPtr(child, GWL_STYLE, original.style);
    SetWindowLongPtr(child, GWL_EXSTYLE, original.ex_style);
    SetParent(child, original.parent);
    if (!original.title.empty()) SetWindowTextW(child, original.title.c_str());
  } else {
    SetParent(child, nullptr);
  }
  const UINT restore_flags = SWP_FRAMECHANGED | SWP_NOZORDER | SWP_NOACTIVATE
      | (found && original.visible ? SWP_SHOWWINDOW : SWP_HIDEWINDOW);
  SetWindowPos(child, nullptr, 0, 0, 0, 0,
      restore_flags | SWP_NOMOVE | SWP_NOSIZE);
  return BoolValue(env, true);
}

napi_value FindMainWindowByProcessId(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  DWORD pid = static_cast<DWORD>(ReadInt32(env, options, "pid"));
  FindWindowContext context = { pid, nullptr, -1 };
  EnumWindows(FindWindowCallback, reinterpret_cast<LPARAM>(&context));
  return HwndOrNull(env, context.best);
}

napi_value FindMainWindowByExecutablePath(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  const std::wstring path = ReadWideString(env, GetNamed(env, options, "executablePath"), L"");
  if (path.empty()) return HwndOrNull(env, nullptr);
  FindPathWindowContext context = { path, nullptr, -1 };
  EnumWindows(FindPathWindowCallback, reinterpret_cast<LPARAM>(&context));
  return HwndOrNull(env, context.best);
}

napi_value ListVisibleTopLevelWindows(napi_env env, napi_callback_info info) {
  DWORD current_session = 0;
  ProcessIdToSessionId(GetCurrentProcessId(), &current_session);
  ListWindowContext context = { GetCurrentProcessId(), current_session, {} };
  EnumWindows(ListWindowCallback, reinterpret_cast<LPARAM>(&context));
  napi_value result;
  napi_create_array_with_length(env, context.windows.size(), &result);
  for (size_t index = 0; index < context.windows.size(); ++index) {
    const VisibleWindow& window = context.windows[index];
    napi_value entry;
    napi_value pid;
    napi_create_object(env, &entry);
    napi_create_uint32(env, window.pid, &pid);
    SetNamed(env, entry, "hwnd", HwndValue(env, window.hwnd));
    SetNamed(env, entry, "pid", pid);
    SetNamed(env, entry, "title", WideStringValue(env, window.title));
    SetNamed(env, entry, "processName", WideStringValue(env, window.process_name));
    napi_set_element(env, result, index, entry);
  }
  return result;
}

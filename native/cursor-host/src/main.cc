#include <windows.h>
#include <shellapi.h>

#include <chrono>
#include <string>
#include <thread>

#include "arguments.h"
#include "dcomp_renderer.h"
#include "input_sampler.h"
#include "pipe_server.h"
#include "recovery_watchdog.h"
#include "system_cursor_lease.h"
#include "target_window_resolver.h"

namespace cursor_host {
namespace {

constexpr std::int64_t kHeartbeatTimeoutMilliseconds = 500;

std::wstring LocalEventName(std::wstring_view kind,
                            std::wstring_view session_id) {
  return L"Local\\AI_FREE_CURSOR_" + std::wstring(kind) + L"_" +
      std::wstring(session_id);
}

int RunHost(const Arguments& arguments) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  const std::wstring hidden_name =
      LocalEventName(L"HIDDEN", arguments.session_id);
  const std::wstring clean_name =
      LocalEventName(L"CLEAN", arguments.session_id);
  HANDLE hidden_event = CreateEventW(
      nullptr, TRUE, FALSE, hidden_name.c_str());
  HANDLE clean_event = CreateEventW(
      nullptr, TRUE, FALSE, clean_name.c_str());
  if (!hidden_event || !clean_event) return 10;
  if (!StartRecoveryWatchdog(
          GetCurrentProcessId(), arguments.session_id,
          hidden_name, clean_name)) {
    CloseHandle(clean_event);
    CloseHandle(hidden_event);
    return 11;
  }

  DCompRenderer renderer;
  InputSampler sampler;
  HostControlState control;
  PipeServer pipe(
      arguments.pipe_name, arguments.token, arguments.session_id, &control);
  if (!renderer.Initialize(arguments.owner_hwnd) || !sampler.Start() ||
      !pipe.Start()) {
    SetEvent(clean_event);
    CloseHandle(clean_event);
    CloseHandle(hidden_event);
    return 12;
  }
  TargetWindowResolver resolver(
      arguments.owner_hwnd, arguments.target_hwnd, renderer.window());
  SystemCursorLease cursor_lease(hidden_event);

  while (!control.shutdown_requested.load()) {
    MSG message{};
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    const POINT position = sampler.LatestPosition();
    const std::int64_t heartbeat_age = MonotonicMilliseconds() -
        control.last_heartbeat_millis.load();
    const bool live = control.authenticated.load() &&
        heartbeat_age <= kHeartbeatTimeoutMilliseconds;
    const bool interactive = live && resolver.IsInteractiveAt(position);
    if (interactive && renderer.RenderAt(position) &&
        renderer.has_committed_frame()) {
      cursor_lease.Acquire();
    } else {
      cursor_lease.Release();
      renderer.Hide();
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  cursor_lease.Release();
  renderer.Hide();
  pipe.Stop();
  sampler.Stop();
  SetEvent(clean_event);
  CloseHandle(clean_event);
  CloseHandle(hidden_event);
  return 0;
}

}  // namespace
}  // namespace cursor_host

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  int argc = 0;
  wchar_t** argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (!argv) return 1;
  cursor_host::Arguments arguments;
  std::wstring error;
  const bool parsed =
      cursor_host::ParseArguments(argc, argv, &arguments, &error);
  LocalFree(argv);
  if (!parsed) return 2;
  if (arguments.watchdog) {
    return cursor_host::RunRecoveryWatchdog(
        arguments.parent_pid, arguments.hidden_event, arguments.clean_event);
  }
  return cursor_host::RunHost(arguments);
}

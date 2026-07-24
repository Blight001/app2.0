#include <windows.h>
#include <shellapi.h>

#include <chrono>
#include <string>
#include <thread>

#include "arguments.h"
#include "cursor_state_store.h"
#include "dcomp_renderer.h"
#include "frame_metrics.h"
#include "input_sampler.h"
#include "pipe_server.h"
#include "recovery_watchdog.h"
#include "system_cursor_lease.h"
#include "target_window_resolver.h"

namespace cursor_host {
namespace {

constexpr std::int64_t kHeartbeatTimeoutMilliseconds = 500;
constexpr std::int64_t kTransportExitTimeoutMilliseconds = 1500;

class ScopedComInitialization {
 public:
  ScopedComInitialization()
      : result_(CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED)) {}
  ~ScopedComInitialization() {
    if (SUCCEEDED(result_)) CoUninitialize();
  }
  bool usable() const {
    return SUCCEEDED(result_) || result_ == RPC_E_CHANGED_MODE;
  }

 private:
  HRESULT result_;
};

std::wstring LocalEventName(std::wstring_view kind,
                            std::wstring_view session_id) {
  return L"Local\\AI_FREE_CURSOR_" + std::wstring(kind) + L"_" +
      std::wstring(session_id);
}

bool ApplyCommand(const Command& command, CursorStateStore* store,
                  DCompRenderer* renderer,
                  TargetWindowResolver* resolver,
                  const std::wstring& cursor_asset_path) {
  if (command.type == CommandType::kSuspend) {
    store->SetSuspended(true);
    return true;
  }
  if (command.type == CommandType::kResume) {
    store->SetSuspended(false);
    return true;
  }
  if (command.type == CommandType::kRegisterTarget &&
      !renderer->initialized()) {
    const HWND owner = reinterpret_cast<HWND>(
        static_cast<std::uintptr_t>(command.owner_hwnd));
    if (!renderer->Initialize(owner, cursor_asset_path)) return false;
  }
  const bool applied = store->Apply(command);
  const CursorTargetState* active = store->active();
  if (applied && active && renderer->initialized()) {
    resolver->UpdateTarget(
        active->owner_hwnd, active->target_hwnd, active->rect,
        renderer->window());
  }
  return applied;
}

void RegisterPrototypeTarget(const Arguments& arguments,
                             CursorStateStore* store,
                             DCompRenderer* renderer,
                             TargetWindowResolver* resolver) {
  if (!arguments.owner_hwnd || !arguments.target_hwnd) return;
  RECT rect{};
  if (!GetWindowRect(arguments.target_hwnd, &rect)) return;
  Command registration;
  registration.type = CommandType::kRegisterTarget;
  registration.tab_id = L"prototype";
  registration.owner_hwnd = reinterpret_cast<std::uintptr_t>(
      arguments.owner_hwnd);
  registration.target_hwnd = reinterpret_cast<std::uintptr_t>(
      arguments.target_hwnd);
  registration.rect = rect;
  ApplyCommand(
      registration, store, renderer, resolver, arguments.cursor_asset_path);
  Command activation;
  activation.type = CommandType::kActivateTarget;
  activation.tab_id = registration.tab_id;
  ApplyCommand(
      activation, store, renderer, resolver, arguments.cursor_asset_path);
}

void SendFrameEvents(const CursorFrame& frame, PipeServer* pipe,
                     std::wstring_view session_id) {
  if (frame.arrived_sequence) {
    pipe->SendEvent(ArrivedEvent(
        session_id, frame.tab_id, *frame.arrived_sequence));
  }
  if (frame.feedback_finished_sequence) {
    pipe->SendEvent(FeedbackFinishedEvent(
        session_id, frame.tab_id, *frame.feedback_finished_sequence));
  }
  if (frame.snapshot_due) {
    pipe->SendEvent(PositionSnapshotEvent(
        session_id, frame.tab_id, frame.position));
  }
}

int RunHost(const Arguments& arguments) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  ScopedComInitialization com;
  if (!com.usable()) return 9;
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

  HostControlState control;
  PipeServer pipe(
      arguments.pipe_name, arguments.token, arguments.session_id, &control);
  DCompRenderer renderer;
  InputSampler sampler;
  CursorStateStore store;
  TargetWindowResolver resolver(nullptr, nullptr, nullptr);
  FrameMetrics frame_metrics;
  if (!sampler.Start() || !pipe.Start()) {
    SetEvent(clean_event);
    CloseHandle(clean_event);
    CloseHandle(hidden_event);
    return 12;
  }
  RegisterPrototypeTarget(arguments, &store, &renderer, &resolver);
  SystemCursorLease cursor_lease(hidden_event);
  std::wstring lost_target;
  bool render_loss_reported = false;
  auto next_render_recovery = std::chrono::steady_clock::time_point{};
  bool had_authenticated_client = false;

  while (!control.shutdown_requested.load()) {
    MSG message{};
    while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
      TranslateMessage(&message);
      DispatchMessageW(&message);
    }
    Command command;
    while (pipe.TakeCommand(&command)) {
      if (!ApplyCommand(
              command, &store, &renderer, &resolver,
              arguments.cursor_asset_path)) {
        pipe.SendEvent(ErrorEvent(arguments.session_id, "COMMAND_REJECTED"));
      }
    }
    const auto now = std::chrono::steady_clock::now();
    const POINT user_position = sampler.LatestPosition();
    const std::int64_t heartbeat_age = MonotonicMilliseconds() -
        control.last_heartbeat_millis.load();
    had_authenticated_client =
        had_authenticated_client || control.authenticated.load();
    const bool live = control.authenticated.load() &&
        heartbeat_age <= kHeartbeatTimeoutMilliseconds;
    if (had_authenticated_client &&
        heartbeat_age > kTransportExitTimeoutMilliseconds) {
      control.shutdown_requested.store(true);
    }
    const bool interactive = live && store.active() &&
        resolver.IsInteractiveAt(user_position);
    store.SetTransportAvailable(live);
    store.FollowUser(user_position, interactive, now);
    const CursorFrame frame = store.Tick(now);
    const bool target_valid =
        !frame.has_target ||
        (IsWindow(frame.target_hwnd) && IsWindow(frame.owner_hwnd));
    if (!target_valid && lost_target != frame.tab_id) {
      lost_target = frame.tab_id;
      pipe.SendEvent(TargetLostEvent(
          arguments.session_id, frame.tab_id));
    } else if (target_valid) {
      lost_target.clear();
    }
    const bool display_allowed = live && frame.has_target &&
        target_valid && resolver.IsInteractiveAt(frame.position);
    const bool rendered = display_allowed && frame.visible &&
        renderer.RenderAt(frame.position, frame.feedback_progress);
    if (rendered) frame_metrics.Record(std::chrono::steady_clock::now());
    if (interactive && rendered && renderer.has_committed_frame()) {
      cursor_lease.Acquire();
    } else {
      const bool was_active = cursor_lease.active();
      cursor_lease.Release();
      if (was_active && control.authenticated.load()) {
        const char* reason = !live ? "transport_unavailable"
            : !target_valid ? "target_lost"
            : !interactive ? "target_inactive"
            : "render_unavailable";
        pipe.SendEvent(CursorRestoredEvent(arguments.session_id, reason));
      }
      if (!rendered) renderer.Hide();
    }
    if (renderer.device_lost() && now >= next_render_recovery) {
      if (!render_loss_reported) {
        pipe.SendEvent(RenderDeviceLostEvent(arguments.session_id));
      }
      render_loss_reported = !renderer.Recover();
      next_render_recovery = now + std::chrono::milliseconds(250);
    } else {
      if (!renderer.device_lost()) render_loss_reported = false;
    }
    SendFrameEvents(frame, &pipe, arguments.session_id);
    FrameTimingSummary timing;
    if (frame_metrics.TakeDueSummary(now, &timing)) {
      pipe.SendEvent(PerformanceEvent(
          arguments.session_id, timing.samples, timing.average_ms,
          timing.p95_ms, timing.p99_ms));
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

#include <windows.h>
#include <shellapi.h>

#include <chrono>
#include <string>
#include <thread>

#include "arguments.h"
#include "cursor_ui_state.h"
#include "dcomp_renderer.h"
#include "frame_metrics.h"
#include "pipe_server.h"

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

void PumpWindowMessages() {
  MSG message{};
  while (PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE)) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
}

void SendFrameEvents(const CursorUiFrame& frame, PipeServer* pipe,
                     std::wstring_view session_id) {
  if (frame.arrived_sequence) {
    pipe->SendEvent(ArrivedEvent(
        session_id, frame.context_id, *frame.arrived_sequence));
  }
  if (frame.effect_finished_sequence) {
    pipe->SendEvent(FeedbackFinishedEvent(
        session_id, frame.context_id, *frame.effect_finished_sequence));
  }
}

int RunHost(const Arguments& arguments) {
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  ScopedComInitialization com;
  if (!com.usable()) return 9;

  HostControlState control;
  PipeServer pipe(
      arguments.pipe_name, arguments.token, arguments.session_id, &control);
  DCompRenderer renderer;
  CursorUiState state;
  FrameMetrics frame_metrics;
  if (!renderer.Initialize(arguments.cursor_asset_path) || !pipe.Start()) {
    return 10;
  }

  bool authenticated_once = false;
  bool render_loss_reported = false;
  auto next_render_recovery = std::chrono::steady_clock::time_point{};
  while (!control.shutdown_requested.load()) {
    PumpWindowMessages();
    Command command;
    while (pipe.TakeCommand(&command)) {
      if (!state.Apply(command)) {
        pipe.SendEvent(ErrorEvent(arguments.session_id, "COMMAND_REJECTED"));
      }
    }

    const auto now = std::chrono::steady_clock::now();
    const std::int64_t heartbeat_age =
        MonotonicMilliseconds() - control.last_heartbeat_millis.load();
    authenticated_once =
        authenticated_once || control.authenticated.load();
    const bool live = control.authenticated.load() &&
        heartbeat_age <= kHeartbeatTimeoutMilliseconds;
    if (authenticated_once &&
        heartbeat_age > kTransportExitTimeoutMilliseconds) {
      control.shutdown_requested.store(true);
    }

    state.SetTransportAvailable(live);
    const CursorUiFrame frame = state.Tick(now);
    const bool rendered = frame.visible && renderer.RenderAt(
        frame.position, frame.button, frame.dragging, frame.effect_progress);
    if (rendered) {
      frame_metrics.Record(std::chrono::steady_clock::now());
    } else {
      renderer.Hide();
    }
    if (renderer.device_lost() && now >= next_render_recovery) {
      if (!render_loss_reported) {
        pipe.SendEvent(RenderDeviceLostEvent(arguments.session_id));
      }
      render_loss_reported = !renderer.Recover();
      next_render_recovery = now + std::chrono::milliseconds(250);
    } else if (!renderer.device_lost()) {
      render_loss_reported = false;
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
  renderer.Hide();
  pipe.Stop();
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
  return parsed ? cursor_host::RunHost(arguments) : 2;
}

#include "../src/protocol.h"
#include "../src/cursor_ui_state.h"
#include "../src/cursor_asset_cache.h"
#include "../src/frame_metrics.h"

#include <objbase.h>

#include <chrono>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <string>

namespace {

int TestProtocol() {
  cursor_host::Command command;
  std::string error;
  const std::string hello =
      R"({"type":"HELLO","version":"2","pid":42,"token":"abc","sessionId":"session"})";
  if (!cursor_host::ParseCommand(hello, &command, &error)) return 10;
  if (command.type != cursor_host::CommandType::kHello ||
      command.version != L"2" || command.pid != 42) {
    return 11;
  }
  const std::string move =
      R"({"type":"MOVE_CURSOR","sessionId":"session","tabId":"tab-a","sequenceId":7,"targetPhysical":{"x":320,"y":240},"durationMs":80,"easing":"linear"})";
  if (!cursor_host::ParseCommand(move, &command, &error)) return 12;
  if (command.type != cursor_host::CommandType::kMoveCursor ||
      command.context_id != L"tab-a" || command.sequence_id != 7 ||
      command.position.x != 320 || command.duration_ms != 80) {
    return 13;
  }
  const std::string right =
      R"({"type":"POINTER_DOWN","sessionId":"session","button":"right"})";
  if (!cursor_host::ParseCommand(right, &command, &error) ||
      command.button != cursor_host::PointerButton::kRight) {
    return 14;
  }
  if (cursor_host::ParseCommand(
          R"({"type":"POINTER_DOWN","sessionId":"session","button":"middle"})",
          &command, &error)) {
    return 15;
  }
  return error == "POINTER_BUTTON_INVALID" ? 0 : 16;
}

int TestFramingAndRejections() {
  const std::string json = R"({"type":"PING"})";
  const auto frame = cursor_host::FrameJson(json);
  std::uint32_t size = 0;
  std::memcpy(&size, frame.data(), sizeof(size));
  if (frame.size() != json.size() + sizeof(size) || size != json.size()) {
    return 20;
  }
  cursor_host::Command command;
  std::string error;
  if (cursor_host::ParseCommand(
          R"({"type":"UNKNOWN","sessionId":"session"})", &command, &error)) {
    return 21;
  }
  const std::string oversized(cursor_host::kMaximumMessageBytes + 1, 'x');
  if (error != "UNKNOWN_COMMAND" ||
      cursor_host::ParseCommand(oversized, &command, &error)) {
    return 22;
  }
  return error == "MESSAGE_SIZE_INVALID" ? 0 : 23;
}

cursor_host::Command Move(
    std::uint64_t sequence, POINT target, std::uint32_t duration) {
  cursor_host::Command command;
  command.type = cursor_host::CommandType::kMoveCursor;
  command.context_id = L"tab-a";
  command.sequence_id = sequence;
  command.position = target;
  command.has_position = true;
  command.duration_ms = duration;
  command.easing = L"linear";
  return command;
}

int TestUiApiState() {
  cursor_host::CursorUiState state;
  state.SetTransportAvailable(true);
  cursor_host::Command show;
  show.type = cursor_host::CommandType::kShowCursor;
  show.position = POINT{100, 100};
  show.has_position = true;
  if (!state.Apply(show)) return 30;
  if (!state.Tick(std::chrono::steady_clock::now()).visible) return 31;

  if (!state.Apply(Move(1, POINT{300, 200}, 0))) return 32;
  if (state.Apply(Move(1, POINT{400, 300}, 0))) return 33;
  auto frame = state.Tick(
      std::chrono::steady_clock::now() + std::chrono::milliseconds(1));
  if (!frame.arrived_sequence || frame.position.x != 300 ||
      frame.position.y != 200) {
    return 34;
  }

  if (!state.Apply(Move(2, POINT{500, 400}, 100))) return 35;
  frame = state.Tick(
      std::chrono::steady_clock::now() + std::chrono::milliseconds(50));
  if (frame.position.x <= 300 || frame.position.x >= 500) return 36;

  cursor_host::Command down;
  down.type = cursor_host::CommandType::kPointerDown;
  down.button = cursor_host::PointerButton::kLeft;
  if (!state.Apply(down) ||
      !state.Apply(Move(3, POINT{600, 450}, 100))) {
    return 37;
  }
  frame = state.Tick(std::chrono::steady_clock::now());
  if (!frame.dragging ||
      frame.button != cursor_host::PointerButton::kLeft) {
    return 38;
  }
  cursor_host::Command up;
  up.type = cursor_host::CommandType::kPointerUp;
  up.button = cursor_host::PointerButton::kLeft;
  if (!state.Apply(up) ||
      state.Tick(std::chrono::steady_clock::now()).dragging) {
    return 39;
  }

  cursor_host::Command effect;
  effect.type = cursor_host::CommandType::kClickEffect;
  effect.context_id = L"tab-a";
  effect.sequence_id = 9;
  effect.button = cursor_host::PointerButton::kRight;
  if (!state.Apply(effect)) return 40;
  frame = state.Tick(std::chrono::steady_clock::now());
  if (frame.button != cursor_host::PointerButton::kRight ||
      frame.effect_progress < 0.0) {
    return 41;
  }

  cursor_host::Command hide;
  hide.type = cursor_host::CommandType::kHideCursor;
  if (!state.Apply(hide) ||
      state.Tick(std::chrono::steady_clock::now()).visible) {
    return 42;
  }
  return 0;
}

int TestStaticCursorAsset(const wchar_t* asset_path) {
  if (!asset_path || !*asset_path) return 50;
  const HRESULT initialized =
      CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(initialized)) return 51;
  cursor_host::CursorAssetCache cache;
  const bool loaded = cache.LoadAni(asset_path);
  std::size_t first_index = SIZE_MAX;
  std::size_t later_index = SIZE_MAX;
  const auto* first = cache.FrameAt(
      std::chrono::steady_clock::now(), &first_index);
  const auto* later = cache.FrameAt(
      std::chrono::steady_clock::now() + std::chrono::seconds(10),
      &later_index);
  const bool valid = loaded && first && later == first &&
      first_index == 0 && later_index == 0 && !cache.animated() &&
      cache.frames().size() == 1;
  CoUninitialize();
  return valid ? 0 : 52;
}

int TestFrameTimingStatistics() {
  constexpr int refresh_rate = 75;
  cursor_host::FrameMetrics metrics;
  const auto interval =
      std::chrono::duration<double>(1.0 / refresh_rate);
  auto now = std::chrono::steady_clock::time_point{};
  for (int frame = 0; frame < refresh_rate * 2; ++frame) {
    metrics.Record(now);
    now += std::chrono::duration_cast<
        std::chrono::steady_clock::duration>(interval);
  }
  const auto summary = metrics.Summarize();
  const double expected = 1000.0 / refresh_rate;
  return summary.samples >= static_cast<std::size_t>(refresh_rate) &&
      std::abs(summary.average_ms - expected) <= 0.05 &&
      std::abs(summary.p99_ms - expected) <= 0.05
      ? 0
      : 60;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  if (const int result = TestProtocol()) return result;
  if (const int result = TestFramingAndRejections()) return result;
  if (const int result = TestUiApiState()) return result;
  if (const int result = TestFrameTimingStatistics()) return result;
  return TestStaticCursorAsset(argc > 1 ? argv[1] : nullptr);
}

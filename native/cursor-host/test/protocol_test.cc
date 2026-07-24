#include "../src/protocol.h"
#include "../src/cursor_state_store.h"
#include "../src/cursor_asset_cache.h"
#include "../src/frame_metrics.h"

#include <windows.h>
#include <objbase.h>
#include <cstdint>
#include <cstring>
#include <string>

namespace {

int TestHello() {
  cursor_host::Command command;
  std::string error;
  const std::string json =
      R"({"type":"HELLO","version":"1","pid":42,"token":"abc","sessionId":"session"})";
  if (!cursor_host::ParseCommand(json, &command, &error)) return 10;
  if (command.type != cursor_host::CommandType::kHello) return 11;
  if (command.pid != 42 || command.token != L"abc") return 12;
  if (command.session_id != L"session" || command.version != L"1") return 13;
  return 0;
}

int TestFraming() {
  const std::string json = R"({"type":"PING"})";
  const auto frame = cursor_host::FrameJson(json);
  if (frame.size() != json.size() + sizeof(std::uint32_t)) return 20;
  std::uint32_t size = 0;
  std::memcpy(&size, frame.data(), sizeof(size));
  if (size != json.size()) return 21;
  if (std::memcmp(frame.data() + sizeof(size), json.data(), json.size()) != 0) {
    return 22;
  }
  return 0;
}

int TestRejections() {
  cursor_host::Command command;
  std::string error;
  if (cursor_host::ParseCommand(
          R"({"type":"UNKNOWN","sessionId":"session"})", &command, &error)) {
    return 30;
  }
  if (error != "UNKNOWN_COMMAND") return 31;
  const std::string oversized(cursor_host::kMaximumMessageBytes + 1, 'x');
  if (cursor_host::ParseCommand(oversized, &command, &error)) return 32;
  return error == "MESSAGE_SIZE_INVALID" ? 0 : 33;
}

cursor_host::Command Registration(
    const wchar_t* tab_id, LONG left, LONG top) {
  cursor_host::Command command;
  command.type = cursor_host::CommandType::kRegisterTarget;
  command.tab_id = tab_id;
  command.target_hwnd = 100;
  command.owner_hwnd = 200;
  command.rect = RECT{left, top, left + 800, top + 600};
  command.position = POINT{left + 20, top + 30};
  command.has_position = true;
  return command;
}

int TestIndependentTargetsAndSequenceCancellation() {
  cursor_host::CursorStateStore store;
  if (!store.Apply(Registration(L"one", 0, 0))) return 40;
  if (!store.Apply(Registration(L"two", 1000, 0))) return 41;
  cursor_host::Command activate;
  activate.type = cursor_host::CommandType::kActivateTarget;
  activate.tab_id = L"one";
  if (!store.Apply(activate)) return 42;
  cursor_host::Command move;
  move.type = cursor_host::CommandType::kMoveAutomation;
  move.tab_id = L"one";
  move.sequence_id = 2;
  move.position = POINT{300, 200};
  move.duration_ms = 0;
  if (!store.Apply(move)) return 43;
  move.sequence_id = 1;
  if (store.Apply(move)) return 44;
  store.SetTransportAvailable(true);
  const auto frame = store.Tick(std::chrono::steady_clock::now());
  if (!frame.arrived_sequence || *frame.arrived_sequence != 2) return 45;
  if (frame.position.x != 300 || frame.position.y != 200) return 46;
  activate.tab_id = L"two";
  if (!store.Apply(activate)) return 47;
  const auto second = store.Tick(std::chrono::steady_clock::now());
  if (second.position.x != 1020 || second.position.y != 30) return 48;
  activate.tab_id = L"one";
  store.Apply(activate);
  const auto restored = store.Tick(std::chrono::steady_clock::now());
  return restored.position.x == 300 && restored.position.y == 200 ? 0 : 49;
}

int TestAnimatedCursorAsset(const wchar_t* asset_path) {
  if (!asset_path || !*asset_path) return 50;
  const HRESULT initialized =
      CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  if (FAILED(initialized)) return 51;
  cursor_host::CursorAssetCache cache;
  const bool loaded = cache.LoadAni(asset_path);
  std::size_t frame_index = 0;
  const auto* frame = cache.FrameAt(
      std::chrono::steady_clock::now(), &frame_index);
  const bool valid = loaded && frame && !cache.frames().empty() &&
      frame->width > 0 && frame->height > 0 &&
      frame->pixels.size() ==
          static_cast<std::size_t>(frame->width) * frame->height * 4;
  CoUninitialize();
  return valid ? 0 : 52;
}

int TestFrameTimingStatistics() {
  for (const int refresh_rate : {60, 120, 144}) {
    cursor_host::FrameMetrics metrics;
    const auto interval = std::chrono::duration<double>(
        1.0 / static_cast<double>(refresh_rate));
    auto now = std::chrono::steady_clock::time_point{};
    for (int frame = 0; frame < refresh_rate * 2; ++frame) {
      metrics.Record(now);
      now += std::chrono::duration_cast<
          std::chrono::steady_clock::duration>(interval);
    }
    const auto summary = metrics.Summarize();
    const double expected = 1000.0 / refresh_rate;
    if (summary.samples < static_cast<std::size_t>(refresh_rate) ||
        std::abs(summary.average_ms - expected) > 0.05 ||
        std::abs(summary.p99_ms - expected) > 0.05) {
      return 60 + refresh_rate;
    }
  }
  return 0;
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  if (const int result = TestHello()) return result;
  if (const int result = TestFraming()) return result;
  if (const int result = TestRejections()) return result;
  if (const int result = TestIndependentTargetsAndSequenceCancellation()) {
    return result;
  }
  if (const int result = TestFrameTimingStatistics()) return result;
  return TestAnimatedCursorAsset(argc > 1 ? argv[1] : nullptr);
}

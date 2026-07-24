#pragma once

#include <windows.h>

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace cursor_host {

constexpr std::uint32_t kMaximumMessageBytes = 64 * 1024;
constexpr std::wstring_view kProtocolVersion = L"1";

enum class CommandType {
  kHello,
  kRegisterTarget,
  kRemoveTarget,
  kActivateTarget,
  kUpdateTargetRect,
  kSetCursorAsset,
  kMoveAutomation,
  kClickFeedback,
  kSuspend,
  kResume,
  kShutdown,
  kPing,
};

struct Command {
  CommandType type;
  std::wstring token;
  std::wstring session_id;
  std::wstring request_id;
  std::wstring version;
  std::wstring tab_id;
  std::wstring asset_id;
  std::wstring easing;
  std::uint32_t pid = 0;
  std::uint64_t target_hwnd = 0;
  std::uint64_t owner_hwnd = 0;
  std::uint64_t sequence_id = 0;
  std::uint32_t duration_ms = 0;
  RECT rect{};
  POINT position{};
  bool has_position = false;
};

bool ParseCommand(std::string_view json, Command* output, std::string* error);
std::vector<std::uint8_t> FrameJson(std::string_view json);
std::string ReadyEvent(std::wstring_view session_id);
std::string PongEvent(std::wstring_view session_id,
                      std::wstring_view request_id);
std::string ErrorEvent(std::wstring_view session_id, std::string_view code);
std::string ArrivedEvent(std::wstring_view session_id,
                         std::wstring_view tab_id,
                         std::uint64_t sequence_id);
std::string FeedbackFinishedEvent(std::wstring_view session_id,
                                  std::wstring_view tab_id,
                                  std::uint64_t sequence_id);
std::string PositionSnapshotEvent(std::wstring_view session_id,
                                  std::wstring_view tab_id,
                                  POINT position);
std::string CursorRestoredEvent(std::wstring_view session_id,
                                std::string_view reason);
std::string TargetLostEvent(std::wstring_view session_id,
                            std::wstring_view tab_id);
std::string RenderDeviceLostEvent(std::wstring_view session_id);
std::string PerformanceEvent(std::wstring_view session_id,
                             std::size_t samples,
                             double average_ms,
                             double p95_ms,
                             double p99_ms);

}  // namespace cursor_host

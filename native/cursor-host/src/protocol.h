#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace cursor_host {

constexpr std::uint32_t kMaximumMessageBytes = 64 * 1024;
constexpr std::wstring_view kProtocolVersion = L"1";

enum class CommandType { kHello, kPing, kShutdown };

struct Command {
  CommandType type;
  std::wstring token;
  std::wstring session_id;
  std::wstring request_id;
  std::wstring version;
  std::uint32_t pid = 0;
};

bool ParseCommand(std::string_view json, Command* output, std::string* error);
std::vector<std::uint8_t> FrameJson(std::string_view json);
std::string ReadyEvent(std::wstring_view session_id);
std::string PongEvent(std::wstring_view session_id,
                      std::wstring_view request_id);
std::string ErrorEvent(std::wstring_view session_id, std::string_view code);

}  // namespace cursor_host

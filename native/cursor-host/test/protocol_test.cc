#include "../src/protocol.h"

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

}  // namespace

int main() {
  if (const int result = TestHello()) return result;
  if (const int result = TestFraming()) return result;
  return TestRejections();
}

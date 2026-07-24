#include "protocol.h"

#include <charconv>
#include <cstring>

namespace cursor_host {
namespace {

bool ExtractString(std::string_view json, std::string_view key,
                   std::wstring* output) {
  const std::string marker = "\"" + std::string(key) + "\"";
  std::size_t cursor = json.find(marker);
  if (cursor == std::string_view::npos) return false;
  cursor = json.find(':', cursor + marker.size());
  if (cursor == std::string_view::npos) return false;
  cursor = json.find('"', cursor + 1);
  if (cursor == std::string_view::npos) return false;
  std::wstring value;
  for (++cursor; cursor < json.size(); ++cursor) {
    const char character = json[cursor];
    if (character == '"') {
      *output = std::move(value);
      return true;
    }
    if (character == '\\' || static_cast<unsigned char>(character) < 0x20) {
      return false;
    }
    value.push_back(static_cast<unsigned char>(character));
  }
  return false;
}

bool ExtractUint32(std::string_view json, std::string_view key,
                   std::uint32_t* output) {
  const std::string marker = "\"" + std::string(key) + "\"";
  std::size_t cursor = json.find(marker);
  if (cursor == std::string_view::npos) return false;
  cursor = json.find(':', cursor + marker.size());
  if (cursor == std::string_view::npos) return false;
  do {
    ++cursor;
  } while (cursor < json.size() && json[cursor] == ' ');
  const char* begin = json.data() + cursor;
  const char* end = json.data() + json.size();
  auto result = std::from_chars(begin, end, *output);
  return result.ec == std::errc();
}

std::string Narrow(std::wstring_view source) {
  std::string output;
  output.reserve(source.size());
  for (wchar_t character : source) {
    if (character > 0x7f || character == '"' || character == '\\') return {};
    output.push_back(static_cast<char>(character));
  }
  return output;
}

std::string EventPrefix(std::string_view type, std::wstring_view session_id) {
  return "{\"type\":\"" + std::string(type) + "\",\"version\":\"1\","
      "\"sessionId\":\"" + Narrow(session_id) + "\"";
}

}  // namespace

bool ParseCommand(std::string_view json, Command* output, std::string* error) {
  if (json.empty() || json.size() > kMaximumMessageBytes) {
    *error = "MESSAGE_SIZE_INVALID";
    return false;
  }
  std::wstring type;
  Command command;
  if (!ExtractString(json, "type", &type) ||
      !ExtractString(json, "sessionId", &command.session_id)) {
    *error = "MESSAGE_SCHEMA_INVALID";
    return false;
  }
  ExtractString(json, "requestId", &command.request_id);
  if (type == L"HELLO") {
    command.type = CommandType::kHello;
    if (!ExtractString(json, "token", &command.token) ||
        !ExtractString(json, "version", &command.version) ||
        !ExtractUint32(json, "pid", &command.pid)) {
      *error = "HELLO_SCHEMA_INVALID";
      return false;
    }
  } else if (type == L"PING") {
    command.type = CommandType::kPing;
  } else if (type == L"SHUTDOWN") {
    command.type = CommandType::kShutdown;
  } else {
    *error = "UNKNOWN_COMMAND";
    return false;
  }
  *output = std::move(command);
  return true;
}

std::vector<std::uint8_t> FrameJson(std::string_view json) {
  const auto size = static_cast<std::uint32_t>(json.size());
  std::vector<std::uint8_t> frame(sizeof(size) + json.size());
  std::memcpy(frame.data(), &size, sizeof(size));
  std::memcpy(frame.data() + sizeof(size), json.data(), json.size());
  return frame;
}

std::string ReadyEvent(std::wstring_view session_id) {
  return EventPrefix("READY", session_id) + "}";
}

std::string PongEvent(std::wstring_view session_id,
                      std::wstring_view request_id) {
  return EventPrefix("PONG", session_id) + ",\"requestId\":\"" +
      Narrow(request_id) + "\"}";
}

std::string ErrorEvent(std::wstring_view session_id, std::string_view code) {
  return EventPrefix("ERROR", session_id) + ",\"code\":\"" +
      std::string(code) + "\"}";
}

}  // namespace cursor_host

#include "protocol.h"

#include <charconv>
#include <cstring>
#include <iomanip>
#include <limits>
#include <sstream>

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

template <typename Integer>
bool ExtractUnsigned(std::string_view json, std::string_view key,
                     Integer* output) {
  const std::string marker = "\"" + std::string(key) + "\"";
  std::size_t cursor = json.find(marker);
  if (cursor == std::string_view::npos) return false;
  cursor = json.find(':', cursor + marker.size());
  if (cursor == std::string_view::npos) return false;
  do {
    ++cursor;
  } while (cursor < json.size() && json[cursor] == ' ');
  const auto result = std::from_chars(
      json.data() + cursor, json.data() + json.size(), *output);
  return result.ec == std::errc();
}

bool ExtractObject(std::string_view json, std::string_view key,
                   std::string_view* output) {
  const std::string marker = "\"" + std::string(key) + "\"";
  std::size_t start = json.find(marker);
  if (start == std::string_view::npos) return false;
  start = json.find('{', start + marker.size());
  if (start == std::string_view::npos) return false;
  int depth = 0;
  for (std::size_t cursor = start; cursor < json.size(); ++cursor) {
    if (json[cursor] == '{') ++depth;
    if (json[cursor] == '}' && --depth == 0) {
      *output = json.substr(start, cursor - start + 1);
      return true;
    }
  }
  return false;
}

bool ExtractSigned(std::string_view json, std::string_view key, LONG* output) {
  const std::string marker = "\"" + std::string(key) + "\"";
  std::size_t cursor = json.find(marker);
  if (cursor == std::string_view::npos) return false;
  cursor = json.find(':', cursor + marker.size());
  if (cursor == std::string_view::npos) return false;
  do {
    ++cursor;
  } while (cursor < json.size() && json[cursor] == ' ');
  long long value = 0;
  const auto result = std::from_chars(
      json.data() + cursor, json.data() + json.size(), value);
  if (result.ec != std::errc() ||
      value < std::numeric_limits<LONG>::min() ||
      value > std::numeric_limits<LONG>::max()) {
    return false;
  }
  *output = static_cast<LONG>(value);
  return true;
}

bool ExtractPoint(std::string_view json, std::string_view key, POINT* output) {
  std::string_view object;
  return ExtractObject(json, key, &object) &&
      ExtractSigned(object, "x", &output->x) &&
      ExtractSigned(object, "y", &output->y);
}

bool ExtractButton(std::string_view json, PointerButton* output) {
  std::wstring button;
  if (!ExtractString(json, "button", &button)) return false;
  if (button == L"left") {
    *output = PointerButton::kLeft;
    return true;
  }
  if (button == L"right") {
    *output = PointerButton::kRight;
    return true;
  }
  return false;
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
  return "{\"type\":\"" + std::string(type) + "\",\"version\":\"2\","
      "\"sessionId\":\"" + Narrow(session_id) + "\"";
}

bool ReadMove(std::string_view json, Command* command) {
  command->has_position =
      ExtractPoint(json, "targetPhysical", &command->position);
  return ExtractString(json, "tabId", &command->context_id) &&
      ExtractUnsigned(json, "sequenceId", &command->sequence_id) &&
      command->has_position &&
      ExtractUnsigned(json, "durationMs", &command->duration_ms);
}

}  // namespace

bool ParseCommand(std::string_view json, Command* output, std::string* error) {
  if (!output || !error || json.empty() || json.size() > kMaximumMessageBytes) {
    if (error) *error = "MESSAGE_SIZE_INVALID";
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
        !ExtractUnsigned(json, "pid", &command.pid)) {
      *error = "HELLO_SCHEMA_INVALID";
      return false;
    }
  } else if (type == L"SHOW_CURSOR") {
    command.type = CommandType::kShowCursor;
    command.has_position =
        ExtractPoint(json, "positionPhysical", &command.position);
  } else if (type == L"HIDE_CURSOR") {
    command.type = CommandType::kHideCursor;
  } else if (type == L"MOVE_CURSOR") {
    command.type = CommandType::kMoveCursor;
    if (!ReadMove(json, &command)) {
      *error = "MOVE_CURSOR_INVALID";
      return false;
    }
    ExtractString(json, "easing", &command.easing);
  } else if (type == L"POINTER_DOWN" || type == L"POINTER_UP") {
    command.type = type == L"POINTER_DOWN"
        ? CommandType::kPointerDown
        : CommandType::kPointerUp;
    if (!ExtractButton(json, &command.button)) {
      *error = "POINTER_BUTTON_INVALID";
      return false;
    }
  } else if (type == L"CLICK_EFFECT") {
    command.type = CommandType::kClickEffect;
    if (!ExtractString(json, "tabId", &command.context_id) ||
        !ExtractUnsigned(json, "sequenceId", &command.sequence_id) ||
        !ExtractButton(json, &command.button)) {
      *error = "CLICK_EFFECT_INVALID";
      return false;
    }
  } else if (type == L"SHUTDOWN") {
    command.type = CommandType::kShutdown;
  } else if (type == L"PING") {
    command.type = CommandType::kPing;
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

std::string ArrivedEvent(std::wstring_view session_id,
                         std::wstring_view context_id,
                         std::uint64_t sequence_id) {
  return EventPrefix("ARRIVED", session_id) + ",\"tabId\":\"" +
      Narrow(context_id) + "\",\"sequenceId\":" +
      std::to_string(sequence_id) + "}";
}

std::string FeedbackFinishedEvent(std::wstring_view session_id,
                                  std::wstring_view context_id,
                                  std::uint64_t sequence_id) {
  return EventPrefix("FEEDBACK_FINISHED", session_id) + ",\"tabId\":\"" +
      Narrow(context_id) + "\",\"sequenceId\":" +
      std::to_string(sequence_id) + "}";
}

std::string RenderDeviceLostEvent(std::wstring_view session_id) {
  return EventPrefix("RENDER_DEVICE_LOST", session_id) + "}";
}

std::string PerformanceEvent(std::wstring_view session_id,
                             std::size_t samples,
                             double average_ms,
                             double p95_ms,
                             double p99_ms) {
  std::ostringstream json;
  json << EventPrefix("PERFORMANCE", session_id)
       << ",\"samples\":" << samples << std::fixed << std::setprecision(3)
       << ",\"averageFrameMs\":" << average_ms
       << ",\"p95FrameMs\":" << p95_ms
       << ",\"p99FrameMs\":" << p99_ms << "}";
  return json.str();
}

}  // namespace cursor_host

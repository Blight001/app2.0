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

bool ExtractUint64(std::string_view json, std::string_view key,
                   std::uint64_t* output) {
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
  auto result = std::from_chars(
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

bool ExtractRect(std::string_view json, std::string_view key, RECT* output) {
  std::string_view object;
  LONG x = 0;
  LONG y = 0;
  LONG width = 0;
  LONG height = 0;
  if (!ExtractObject(json, key, &object) ||
      !ExtractSigned(object, "x", &x) ||
      !ExtractSigned(object, "y", &y) ||
      !ExtractSigned(object, "width", &width) ||
      !ExtractSigned(object, "height", &height) ||
      width <= 0 || height <= 0) {
    return false;
  }
  *output = RECT{x, y, x + width, y + height};
  return true;
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

bool ReadTargetCommand(std::string_view json, Command* command) {
  return ExtractString(json, "tabId", &command->tab_id);
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
  } else if (type == L"REGISTER_TARGET") {
    command.type = CommandType::kRegisterTarget;
    std::wstring target;
    std::wstring owner;
    command.has_position = ExtractPoint(json, "initialPosition", &command.position);
    if (!ReadTargetCommand(json, &command) ||
        !ExtractString(json, "targetHwnd", &target) ||
        !ExtractString(json, "ownerHwnd", &owner) ||
        !ExtractRect(json, "rectPhysical", &command.rect)) {
      *error = "REGISTER_TARGET_INVALID";
      return false;
    }
    try {
      command.target_hwnd = std::stoull(target);
      command.owner_hwnd = std::stoull(owner);
    } catch (...) {
      *error = "REGISTER_TARGET_INVALID";
      return false;
    }
  } else if (type == L"REMOVE_TARGET") {
    command.type = CommandType::kRemoveTarget;
    if (!ReadTargetCommand(json, &command)) return false;
  } else if (type == L"ACTIVATE_TARGET") {
    command.type = CommandType::kActivateTarget;
    if (!ReadTargetCommand(json, &command)) return false;
  } else if (type == L"UPDATE_TARGET_RECT") {
    command.type = CommandType::kUpdateTargetRect;
    if (!ReadTargetCommand(json, &command) ||
        !ExtractRect(json, "rectPhysical", &command.rect)) return false;
  } else if (type == L"SET_CURSOR_ASSET") {
    command.type = CommandType::kSetCursorAsset;
    if (!ReadTargetCommand(json, &command) ||
        !ExtractString(json, "assetId", &command.asset_id)) return false;
  } else if (type == L"MOVE_AUTOMATION") {
    command.type = CommandType::kMoveAutomation;
    if (!ReadTargetCommand(json, &command) ||
        !ExtractUint64(json, "sequenceId", &command.sequence_id) ||
        !ExtractPoint(json, "targetPhysical", &command.position) ||
        !ExtractUint32(json, "durationMs", &command.duration_ms)) return false;
    ExtractString(json, "easing", &command.easing);
    command.has_position = true;
  } else if (type == L"CLICK_FEEDBACK") {
    command.type = CommandType::kClickFeedback;
    if (!ReadTargetCommand(json, &command) ||
        !ExtractUint64(json, "sequenceId", &command.sequence_id)) return false;
  } else if (type == L"SUSPEND") {
    command.type = CommandType::kSuspend;
  } else if (type == L"RESUME") {
    command.type = CommandType::kResume;
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
                         std::wstring_view tab_id,
                         std::uint64_t sequence_id) {
  return EventPrefix("ARRIVED", session_id) + ",\"tabId\":\"" +
      Narrow(tab_id) + "\",\"sequenceId\":" + std::to_string(sequence_id) +
      "}";
}

std::string FeedbackFinishedEvent(std::wstring_view session_id,
                                  std::wstring_view tab_id,
                                  std::uint64_t sequence_id) {
  return EventPrefix("FEEDBACK_FINISHED", session_id) + ",\"tabId\":\"" +
      Narrow(tab_id) + "\",\"sequenceId\":" + std::to_string(sequence_id) +
      "}";
}

std::string PositionSnapshotEvent(std::wstring_view session_id,
                                  std::wstring_view tab_id,
                                  POINT position) {
  return EventPrefix("POSITION_SNAPSHOT", session_id) + ",\"tabId\":\"" +
      Narrow(tab_id) + "\",\"positionPhysical\":{\"x\":" +
      std::to_string(position.x) + ",\"y\":" + std::to_string(position.y) +
      "}}";
}

std::string CursorRestoredEvent(std::wstring_view session_id,
                                std::string_view reason) {
  return EventPrefix("CURSOR_RESTORED", session_id) + ",\"reason\":\"" +
      std::string(reason) + "\"}";
}

std::string TargetLostEvent(std::wstring_view session_id,
                            std::wstring_view tab_id) {
  return EventPrefix("TARGET_LOST", session_id) + ",\"tabId\":\"" +
      Narrow(tab_id) + "\"}";
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

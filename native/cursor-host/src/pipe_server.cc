#include "pipe_server.h"

#include "pipe_security.h"
#include "protocol.h"

#include <array>
#include <vector>

namespace cursor_host {
namespace {

bool ReadExact(HANDLE pipe, void* data, DWORD size) {
  auto* output = static_cast<std::uint8_t*>(data);
  DWORD total = 0;
  while (total < size) {
    DWORD read = 0;
    if (!ReadFile(pipe, output + total, size - total, &read, nullptr) ||
        read == 0) {
      return false;
    }
    total += read;
  }
  return true;
}

}  // namespace

std::int64_t MonotonicMilliseconds() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

PipeServer::PipeServer(std::wstring pipe_name, std::wstring token,
                       std::wstring session_id, HostControlState* state)
    : pipe_name_(std::move(pipe_name)),
      token_(std::move(token)),
      session_id_(std::move(session_id)),
      state_(state) {}

PipeServer::~PipeServer() { Stop(); }

bool PipeServer::Start() {
  if (thread_.joinable()) return false;
  thread_ = std::thread(&PipeServer::Run, this);
  return true;
}

void PipeServer::Stop() {
  stopping_.store(true);
  HANDLE pipe = active_pipe_.exchange(INVALID_HANDLE_VALUE);
  if (pipe != INVALID_HANDLE_VALUE) {
    CancelIoEx(pipe, nullptr);
    DisconnectNamedPipe(pipe);
    CloseHandle(pipe);
  }
  if (thread_.joinable()) thread_.join();
}

void PipeServer::Run() {
  CurrentUserPipeSecurity security;
  if (!security.valid()) {
    state_->shutdown_requested.store(true);
    return;
  }
  HANDLE pipe = CreateNamedPipeW(
      pipe_name_.c_str(), PIPE_ACCESS_DUPLEX,
      PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT |
          PIPE_REJECT_REMOTE_CLIENTS,
      1, kMaximumMessageBytes + 4, kMaximumMessageBytes + 4, 0,
      security.attributes());
  if (pipe == INVALID_HANDLE_VALUE) {
    state_->shutdown_requested.store(true);
    return;
  }
  active_pipe_.store(pipe);
  const bool connected = ConnectNamedPipe(pipe, nullptr) ||
      GetLastError() == ERROR_PIPE_CONNECTED;
  if (connected && !stopping_.load()) ServeClient(pipe);
  if (active_pipe_.exchange(INVALID_HANDLE_VALUE) == pipe) {
    DisconnectNamedPipe(pipe);
    CloseHandle(pipe);
  }
  state_->authenticated.store(false);
}

bool PipeServer::ServeClient(HANDLE pipe) {
  while (!stopping_.load()) {
    std::uint32_t size = 0;
    if (!ReadExact(pipe, &size, sizeof(size))) return false;
    if (size == 0 || size > kMaximumMessageBytes) {
      WriteJson(pipe, ErrorEvent(session_id_, "MESSAGE_SIZE_INVALID"));
      return false;
    }
    std::string message(size, '\0');
    if (!ReadExact(pipe, message.data(), size)) return false;
    if (!HandleMessage(pipe, message)) return false;
  }
  return true;
}

bool PipeServer::HandleMessage(HANDLE pipe, const std::string& message) {
  Command command;
  std::string error;
  if (!ParseCommand(message, &command, &error)) {
    WriteJson(pipe, ErrorEvent(session_id_, error));
    return false;
  }
  if (command.session_id != session_id_) {
    WriteJson(pipe, ErrorEvent(session_id_, "SESSION_MISMATCH"));
    return false;
  }
  if (!state_->authenticated.load()) {
    if (command.type != CommandType::kHello || command.token != token_ ||
        command.version != kProtocolVersion || command.pid == 0) {
      WriteJson(pipe, ErrorEvent(session_id_, "HELLO_REJECTED"));
      return false;
    }
    state_->authenticated.store(true);
    state_->last_heartbeat_millis.store(MonotonicMilliseconds());
    return WriteJson(pipe, ReadyEvent(session_id_));
  }
  if (command.type == CommandType::kPing) {
    state_->last_heartbeat_millis.store(MonotonicMilliseconds());
    return WriteJson(pipe, PongEvent(session_id_, command.request_id));
  }
  if (command.type == CommandType::kShutdown) {
    state_->shutdown_requested.store(true);
    return false;
  }
  WriteJson(pipe, ErrorEvent(session_id_, "COMMAND_NOT_ALLOWED"));
  return false;
}

bool PipeServer::WriteJson(HANDLE pipe, const std::string& json) {
  const std::vector<std::uint8_t> frame = FrameJson(json);
  DWORD written = 0;
  return WriteFile(pipe, frame.data(), static_cast<DWORD>(frame.size()),
                   &written, nullptr) &&
      written == frame.size();
}

}  // namespace cursor_host

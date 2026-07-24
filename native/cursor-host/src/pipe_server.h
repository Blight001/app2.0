#pragma once

#include <windows.h>

#include <atomic>
#include <chrono>
#include <deque>
#include <mutex>
#include <string>
#include <thread>

#include "protocol.h"

namespace cursor_host {

struct HostControlState {
  std::atomic<bool> authenticated{false};
  std::atomic<bool> shutdown_requested{false};
  std::atomic<std::int64_t> last_heartbeat_millis{0};
  std::mutex command_mutex;
  std::deque<Command> commands;
};

class PipeServer {
 public:
  PipeServer(std::wstring pipe_name, std::wstring token,
             std::wstring session_id, HostControlState* state);
  ~PipeServer();
  bool Start();
  void Stop();
  bool SendEvent(const std::string& json);
  bool TakeCommand(Command* command);

 private:
  void Run();
  bool ServeClient(HANDLE pipe);
  bool HandleMessage(HANDLE pipe, const std::string& message);
  bool WriteJson(HANDLE pipe, const std::string& json);

  std::wstring pipe_name_;
  std::wstring token_;
  std::wstring session_id_;
  HostControlState* state_;
  std::atomic<bool> stopping_{false};
  std::atomic<HANDLE> active_pipe_{INVALID_HANDLE_VALUE};
  std::mutex write_mutex_;
  std::thread thread_;
};

std::int64_t MonotonicMilliseconds();

}  // namespace cursor_host

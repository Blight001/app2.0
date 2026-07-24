#pragma once

#include <windows.h>

#include <atomic>
#include <thread>

namespace cursor_host {

class InputSampler {
 public:
  InputSampler() = default;
  ~InputSampler();
  bool Start();
  void Stop();
  POINT LatestPosition() const;

 private:
  static LRESULT CALLBACK MouseHook(int code, WPARAM message, LPARAM data);
  void Run();

  static InputSampler* instance_;
  std::atomic<LONG> x_{0};
  std::atomic<LONG> y_{0};
  std::atomic<DWORD> thread_id_{0};
  std::atomic<bool> ready_{false};
  std::thread thread_;
};

}  // namespace cursor_host

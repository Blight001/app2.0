#include "input_sampler.h"

#include <chrono>

namespace cursor_host {

InputSampler* InputSampler::instance_ = nullptr;

InputSampler::~InputSampler() { Stop(); }

bool InputSampler::Start() {
  if (thread_.joinable() || instance_) return false;
  POINT initial{};
  GetCursorPos(&initial);
  x_.store(initial.x);
  y_.store(initial.y);
  instance_ = this;
  thread_ = std::thread(&InputSampler::Run, this);
  for (int attempt = 0; attempt < 100 && !ready_.load(); ++attempt) {
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }
  return ready_.load();
}

void InputSampler::Stop() {
  const DWORD id = thread_id_.load();
  if (id) PostThreadMessageW(id, WM_QUIT, 0, 0);
  if (thread_.joinable()) thread_.join();
  if (instance_ == this) instance_ = nullptr;
  thread_id_.store(0);
  ready_.store(false);
}

POINT InputSampler::LatestPosition() const {
  return POINT{x_.load(), y_.load()};
}

LRESULT CALLBACK InputSampler::MouseHook(int code, WPARAM message,
                                         LPARAM data) {
  if (code >= 0 && instance_ && message == WM_MOUSEMOVE) {
    const auto* event = reinterpret_cast<const MSLLHOOKSTRUCT*>(data);
    instance_->x_.store(event->pt.x, std::memory_order_relaxed);
    instance_->y_.store(event->pt.y, std::memory_order_relaxed);
  }
  return CallNextHookEx(nullptr, code, message, data);
}

void InputSampler::Run() {
  thread_id_.store(GetCurrentThreadId());
  MSG warmup{};
  PeekMessageW(&warmup, nullptr, WM_USER, WM_USER, PM_NOREMOVE);
  HHOOK hook = SetWindowsHookExW(
      WH_MOUSE_LL, &InputSampler::MouseHook, GetModuleHandleW(nullptr), 0);
  ready_.store(hook != nullptr);
  if (!hook) return;
  MSG message{};
  while (GetMessageW(&message, nullptr, 0, 0) > 0) {
    TranslateMessage(&message);
    DispatchMessageW(&message);
  }
  UnhookWindowsHookEx(hook);
}

}  // namespace cursor_host

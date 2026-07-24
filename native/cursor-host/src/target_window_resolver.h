#pragma once

#include <windows.h>

#include <chrono>

namespace cursor_host {

class TargetWindowResolver {
 public:
  TargetWindowResolver(HWND owner, HWND target, HWND overlay);
  void UpdateTarget(HWND owner, HWND target, RECT rect, HWND overlay);
  bool IsInteractiveAt(POINT point);
  RECT TargetRect() const;

 private:
  bool Resolve(POINT point) const;
  bool BelongsTo(HWND window, HWND expected) const;
  HWND WindowBelowOverlay(POINT point) const;

  HWND owner_;
  HWND target_;
  HWND overlay_;
  RECT target_rect_{};
  HWND cached_foreground_ = nullptr;
  POINT cached_point_{LONG_MIN, LONG_MIN};
  bool cached_result_ = false;
  std::chrono::steady_clock::time_point cached_at_{};
};

}  // namespace cursor_host

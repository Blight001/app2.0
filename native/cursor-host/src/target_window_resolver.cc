#include "target_window_resolver.h"

#include <algorithm>

namespace cursor_host {
namespace {

bool Contains(const RECT& rect, POINT point) {
  return point.x >= rect.left && point.x < rect.right &&
      point.y >= rect.top && point.y < rect.bottom;
}

HWND Root(HWND window) {
  return window ? GetAncestor(window, GA_ROOT) : nullptr;
}

}  // namespace

TargetWindowResolver::TargetWindowResolver(
    HWND owner, HWND target, HWND overlay)
    : owner_(owner), target_(target), overlay_(overlay) {}

bool TargetWindowResolver::IsInteractiveAt(POINT point) {
  const auto now = std::chrono::steady_clock::now();
  const HWND foreground = GetForegroundWindow();
  const auto age =
      std::chrono::duration_cast<std::chrono::milliseconds>(now - cached_at_);
  const LONG distance = std::abs(point.x - cached_point_.x) +
      std::abs(point.y - cached_point_.y);
  if (foreground == cached_foreground_ && distance <= 2 &&
      age < std::chrono::milliseconds(12)) {
    return cached_result_;
  }
  cached_foreground_ = foreground;
  cached_point_ = point;
  cached_at_ = now;
  cached_result_ = Resolve(point);
  return cached_result_;
}

RECT TargetWindowResolver::TargetRect() const {
  RECT rect{};
  if (IsWindow(target_)) GetWindowRect(target_, &rect);
  return rect;
}

bool TargetWindowResolver::Resolve(POINT point) const {
  if (!IsWindow(owner_) || !IsWindow(target_) || !IsWindowVisible(owner_) ||
      !IsWindowVisible(target_) || IsIconic(owner_)) {
    return false;
  }
  const RECT target_rect = TargetRect();
  if (!Contains(target_rect, point)) return false;
  const HWND foreground = GetForegroundWindow();
  if (!BelongsTo(foreground, owner_) && !BelongsTo(foreground, target_)) {
    return false;
  }
  HWND hit = WindowFromPoint(point);
  if (hit == overlay_ || BelongsTo(hit, overlay_)) {
    hit = WindowBelowOverlay(point);
  }
  return BelongsTo(hit, target_);
}

bool TargetWindowResolver::BelongsTo(HWND window, HWND expected) const {
  if (!window || !expected) return false;
  if (window == expected || Root(window) == Root(expected)) return true;
  for (HWND current = window; current; current = GetParent(current)) {
    if (current == expected) return true;
  }
  for (HWND current = window; current; current = GetWindow(current, GW_OWNER)) {
    if (current == expected || Root(current) == Root(expected)) return true;
  }
  return false;
}

HWND TargetWindowResolver::WindowBelowOverlay(POINT point) const {
  for (HWND candidate = GetWindow(overlay_, GW_HWNDNEXT); candidate;
       candidate = GetWindow(candidate, GW_HWNDNEXT)) {
    RECT rect{};
    if (IsWindowVisible(candidate) && GetWindowRect(candidate, &rect) &&
        Contains(rect, point)) {
      return candidate;
    }
  }
  return nullptr;
}

}  // namespace cursor_host

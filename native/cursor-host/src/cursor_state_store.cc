#include "cursor_state_store.h"

#include <algorithm>
#include <cmath>

namespace cursor_host {
namespace {

POINT ClampPoint(POINT point, const RECT& rect) {
  return POINT{
      std::clamp(point.x, rect.left, std::max(rect.left, rect.right - 1)),
      std::clamp(point.y, rect.top, std::max(rect.top, rect.bottom - 1)),
  };
}

}  // namespace

bool CursorStateStore::Apply(const Command& command) {
  if (command.type == CommandType::kRegisterTarget) return Register(command);
  if (command.type == CommandType::kRemoveTarget) {
    const bool was_active = active_tab_id_ == command.tab_id;
    const bool removed = targets_.erase(command.tab_id) > 0;
    if (was_active) {
      active_tab_id_.clear();
      animation_.reset();
      feedback_.reset();
    }
    return removed;
  }
  if (command.type == CommandType::kActivateTarget) {
    if (!targets_.contains(command.tab_id)) return false;
    active_tab_id_ = command.tab_id;
    animation_.reset();
    feedback_.reset();
    interactive_ = false;
    return true;
  }
  auto found = targets_.find(command.tab_id);
  if (found == targets_.end()) return false;
  if (command.type == CommandType::kUpdateTargetRect) {
    found->second.rect = command.rect;
    found->second.position = ClampPoint(found->second.position, command.rect);
    return true;
  }
  if (command.type == CommandType::kSetCursorAsset) {
    found->second.asset_id = command.asset_id;
    return true;
  }
  if (command.type == CommandType::kMoveAutomation) return Move(command);
  if (command.type == CommandType::kClickFeedback) {
    if (active_tab_id_ != command.tab_id ||
        command.sequence_id < found->second.sequence_id) {
      return false;
    }
    feedback_ = Feedback{
        std::chrono::steady_clock::now(),
        std::chrono::milliseconds(240),
        command.sequence_id,
    };
    return true;
  }
  return false;
}

bool CursorStateStore::Register(const Command& command) {
  CursorTargetState state;
  state.tab_id = command.tab_id;
  state.target_hwnd = reinterpret_cast<HWND>(
      static_cast<std::uintptr_t>(command.target_hwnd));
  state.owner_hwnd = reinterpret_cast<HWND>(
      static_cast<std::uintptr_t>(command.owner_hwnd));
  state.rect = command.rect;
  state.position = command.has_position
      ? ClampPoint(command.position, command.rect)
      : POINT{
          command.rect.left + (command.rect.right - command.rect.left) / 2,
          command.rect.top + (command.rect.bottom - command.rect.top) / 2,
      };
  state.last_position_change = std::chrono::steady_clock::now();
  targets_.insert_or_assign(command.tab_id, std::move(state));
  return true;
}

bool CursorStateStore::Move(const Command& command) {
  if (active_tab_id_ != command.tab_id) return false;
  CursorTargetState& state = targets_.at(command.tab_id);
  if (command.sequence_id <= state.sequence_id) return false;
  state.sequence_id = command.sequence_id;
  state.following_user = false;
  easing_ = command.easing.empty() ? L"ease-out" : command.easing;
  animation_ = Animation{
      state.position,
      ClampPoint(command.position, state.rect),
      std::chrono::steady_clock::now(),
      std::chrono::milliseconds(std::clamp(command.duration_ms, 0u, 5000u)),
      command.sequence_id,
  };
  feedback_.reset();
  return true;
}

void CursorStateStore::FollowUser(
    POINT position, bool interactive,
    std::chrono::steady_clock::time_point now) {
  interactive_ = interactive;
  CursorTargetState* state = const_cast<CursorTargetState*>(active());
  if (!state || animation_ || !interactive) return;
  const POINT next = ClampPoint(position, state->rect);
  if (next.x == state->position.x && next.y == state->position.y) return;
  state->position = next;
  state->following_user = true;
  state->position_dirty = true;
  state->last_position_change = now;
}

CursorFrame CursorStateStore::Tick(
    std::chrono::steady_clock::time_point now) {
  CursorFrame frame;
  CursorTargetState* state = const_cast<CursorTargetState*>(active());
  if (!state) return frame;
  frame.has_target = true;
  frame.target_hwnd = state->target_hwnd;
  frame.owner_hwnd = state->owner_hwnd;
  frame.rect = state->rect;
  frame.tab_id = state->tab_id;
  if (animation_) {
    const double elapsed = std::chrono::duration<double>(
        now - animation_->started_at).count();
    const double duration =
        std::chrono::duration<double>(animation_->duration).count();
    const double progress = duration <= 0.0
        ? 1.0
        : std::clamp(elapsed / duration, 0.0, 1.0);
    const double eased = Ease(progress);
    state->position.x = static_cast<LONG>(std::lround(
        animation_->start.x +
        (animation_->target.x - animation_->start.x) * eased));
    state->position.y = static_cast<LONG>(std::lround(
        animation_->start.y +
        (animation_->target.y - animation_->start.y) * eased));
    if (progress >= 1.0) {
      state->position = animation_->target;
      frame.arrived_sequence = animation_->sequence_id;
      animation_.reset();
      state->position_dirty = true;
      state->last_position_change = now;
    }
  }
  if (feedback_) {
    frame.feedback_active = true;
    frame.feedback_progress = std::clamp(
        std::chrono::duration<double>(now - feedback_->started_at).count() /
            std::chrono::duration<double>(feedback_->duration).count(),
        0.0, 1.0);
    if (now - feedback_->started_at >= feedback_->duration) {
      frame.feedback_finished_sequence = feedback_->sequence_id;
      feedback_.reset();
      frame.feedback_active = false;
      frame.feedback_progress = -1.0;
    }
  }
  frame.position = state->position;
  frame.visible = !suspended_ && transport_available_;
  if (state->position_dirty && !animation_ &&
      now - state->last_position_change >= std::chrono::milliseconds(120)) {
    frame.snapshot_due = true;
    state->position_dirty = false;
  }
  return frame;
}

void CursorStateStore::SetSuspended(bool suspended) {
  suspended_ = suspended;
  if (suspended) interactive_ = false;
}

void CursorStateStore::SetTransportAvailable(bool available) {
  transport_available_ = available;
  if (!available) interactive_ = false;
}

const CursorTargetState* CursorStateStore::active() const {
  const auto found = targets_.find(active_tab_id_);
  return found == targets_.end() ? nullptr : &found->second;
}

double CursorStateStore::Ease(double progress) const {
  if (easing_ == L"linear") return progress;
  if (easing_ == L"ease-in-out") {
    return progress < 0.5
        ? 2.0 * progress * progress
        : 1.0 - std::pow(-2.0 * progress + 2.0, 2.0) / 2.0;
  }
  return 1.0 - std::pow(1.0 - progress, 3.0);
}

}  // namespace cursor_host

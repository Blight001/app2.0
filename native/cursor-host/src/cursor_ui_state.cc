#include "cursor_ui_state.h"

#include <algorithm>
#include <cmath>

namespace cursor_host {

bool CursorUiState::Apply(const Command& command) {
  if (command.type == CommandType::kShowCursor) {
    visible_ = true;
    if (command.has_position) {
      position_ = command.position;
      position_initialized_ = true;
    }
    return true;
  }
  if (command.type == CommandType::kHideCursor) {
    visible_ = false;
    dragging_ = false;
    button_down_ = PointerButton::kNone;
    animation_.reset();
    effect_.reset();
    return true;
  }
  if (command.type == CommandType::kMoveCursor) return Move(command);
  if (command.type == CommandType::kPointerDown) {
    if (command.button == PointerButton::kNone) return false;
    visible_ = true;
    button_down_ = command.button;
    dragging_ = false;
    effect_.reset();
    return true;
  }
  if (command.type == CommandType::kPointerUp) {
    if (command.button == PointerButton::kNone) return false;
    button_down_ = PointerButton::kNone;
    dragging_ = false;
    return true;
  }
  if (command.type == CommandType::kClickEffect) {
    if (command.button == PointerButton::kNone) return false;
    visible_ = true;
    context_id_ = command.context_id;
    effect_ = Effect{
        command.button,
        std::chrono::steady_clock::now(),
        std::chrono::milliseconds(280),
        command.sequence_id,
    };
    return true;
  }
  return false;
}

bool CursorUiState::Move(const Command& command) {
  if (!command.has_position || command.sequence_id <= last_sequence_id_) {
    return false;
  }
  last_sequence_id_ = command.sequence_id;
  context_id_ = command.context_id;
  visible_ = true;
  if (!position_initialized_) {
    position_ = command.position;
    position_initialized_ = true;
  }
  easing_ = command.easing.empty() ? L"ease-out" : command.easing;
  animation_ = Animation{
      position_,
      command.position,
      std::chrono::steady_clock::now(),
      std::chrono::milliseconds(std::clamp(command.duration_ms, 0u, 5000u)),
      command.sequence_id,
      command.context_id,
  };
  dragging_ = button_down_ != PointerButton::kNone;
  return true;
}

CursorUiFrame CursorUiState::Tick(
    std::chrono::steady_clock::time_point now) {
  CursorUiFrame frame;
  if (animation_) {
    const double elapsed =
        std::chrono::duration<double>(now - animation_->started_at).count();
    const double duration =
        std::chrono::duration<double>(animation_->duration).count();
    const double progress = duration <= 0.0
        ? 1.0
        : std::clamp(elapsed / duration, 0.0, 1.0);
    const double eased = Ease(progress);
    position_.x = static_cast<LONG>(std::lround(
        animation_->start.x +
        (animation_->target.x - animation_->start.x) * eased));
    position_.y = static_cast<LONG>(std::lround(
        animation_->start.y +
        (animation_->target.y - animation_->start.y) * eased));
    if (progress >= 1.0) {
      position_ = animation_->target;
      frame.arrived_sequence = animation_->sequence_id;
      context_id_ = animation_->context_id;
      animation_.reset();
    }
  }
  if (effect_) {
    frame.effect_progress = std::clamp(
        std::chrono::duration<double>(now - effect_->started_at).count() /
            std::chrono::duration<double>(effect_->duration).count(),
        0.0, 1.0);
    if (now - effect_->started_at >= effect_->duration) {
      frame.effect_finished_sequence = effect_->sequence_id;
      effect_.reset();
      frame.effect_progress = -1.0;
    }
  }
  frame.visible = transport_available_ && visible_ && position_initialized_;
  frame.position = position_;
  frame.context_id = context_id_;
  frame.dragging = dragging_;
  frame.button = effect_ ? effect_->button : button_down_;
  return frame;
}

void CursorUiState::SetTransportAvailable(bool available) {
  transport_available_ = available;
}

double CursorUiState::Ease(double progress) const {
  if (easing_ == L"linear") return progress;
  if (easing_ == L"ease-in-out") {
    return progress < 0.5
        ? 2.0 * progress * progress
        : 1.0 - std::pow(-2.0 * progress + 2.0, 2.0) / 2.0;
  }
  return 1.0 - std::pow(1.0 - progress, 3.0);
}

}  // namespace cursor_host

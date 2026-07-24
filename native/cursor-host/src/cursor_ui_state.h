#pragma once

#include <windows.h>

#include <chrono>
#include <cstdint>
#include <optional>
#include <string>

#include "protocol.h"

namespace cursor_host {

struct CursorUiFrame {
  bool visible = false;
  bool dragging = false;
  POINT position{};
  PointerButton button = PointerButton::kNone;
  double effect_progress = -1.0;
  std::wstring context_id;
  std::optional<std::uint64_t> arrived_sequence;
  std::optional<std::uint64_t> effect_finished_sequence;
};

class CursorUiState {
 public:
  bool Apply(const Command& command);
  CursorUiFrame Tick(std::chrono::steady_clock::time_point now);
  void SetTransportAvailable(bool available);

 private:
  struct Animation {
    POINT start{};
    POINT target{};
    std::chrono::steady_clock::time_point started_at{};
    std::chrono::milliseconds duration{};
    std::uint64_t sequence_id = 0;
    std::wstring context_id;
  };
  struct Effect {
    PointerButton button = PointerButton::kNone;
    std::chrono::steady_clock::time_point started_at{};
    std::chrono::milliseconds duration{280};
    std::uint64_t sequence_id = 0;
  };

  bool Move(const Command& command);
  double Ease(double progress) const;

  POINT position_{};
  bool position_initialized_ = false;
  bool visible_ = false;
  bool transport_available_ = false;
  bool dragging_ = false;
  PointerButton button_down_ = PointerButton::kNone;
  std::uint64_t last_sequence_id_ = 0;
  std::wstring context_id_;
  std::wstring easing_ = L"ease-out";
  std::optional<Animation> animation_;
  std::optional<Effect> effect_;
};

}  // namespace cursor_host

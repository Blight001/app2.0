#pragma once

#include <windows.h>

#include <chrono>
#include <cstdint>
#include <optional>
#include <string>
#include <unordered_map>

#include "protocol.h"

namespace cursor_host {

struct CursorTargetState {
  std::wstring tab_id;
  HWND target_hwnd = nullptr;
  HWND owner_hwnd = nullptr;
  RECT rect{};
  POINT position{};
  std::wstring asset_id;
  std::uint64_t sequence_id = 0;
  bool following_user = true;
  bool position_dirty = true;
  std::chrono::steady_clock::time_point last_position_change{};
};

struct CursorFrame {
  bool has_target = false;
  bool visible = false;
  bool feedback_active = false;
  double feedback_progress = -1.0;
  HWND target_hwnd = nullptr;
  HWND owner_hwnd = nullptr;
  RECT rect{};
  POINT position{};
  std::wstring tab_id;
  std::optional<std::uint64_t> arrived_sequence;
  std::optional<std::uint64_t> feedback_finished_sequence;
  bool snapshot_due = false;
};

class CursorStateStore {
 public:
  bool Apply(const Command& command);
  CursorFrame Tick(std::chrono::steady_clock::time_point now);
  void FollowUser(POINT position, bool interactive,
                  std::chrono::steady_clock::time_point now);
  void SetSuspended(bool suspended);
  void SetTransportAvailable(bool available);
  const CursorTargetState* active() const;

 private:
  struct Animation {
    POINT start{};
    POINT target{};
    std::chrono::steady_clock::time_point started_at{};
    std::chrono::milliseconds duration{};
    std::uint64_t sequence_id = 0;
  };
  struct Feedback {
    std::chrono::steady_clock::time_point started_at{};
    std::chrono::milliseconds duration{240};
    std::uint64_t sequence_id = 0;
  };

  bool Register(const Command& command);
  bool Move(const Command& command);
  double Ease(double progress) const;

  std::unordered_map<std::wstring, CursorTargetState> targets_;
  std::wstring active_tab_id_;
  std::optional<Animation> animation_;
  std::optional<Feedback> feedback_;
  std::wstring easing_ = L"ease-out";
  bool suspended_ = false;
  bool transport_available_ = false;
  bool interactive_ = false;
};

}  // namespace cursor_host

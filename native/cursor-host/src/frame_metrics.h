#pragma once

#include <chrono>
#include <cstddef>
#include <vector>

namespace cursor_host {

struct FrameTimingSummary {
  std::size_t samples = 0;
  double average_ms = 0;
  double p95_ms = 0;
  double p99_ms = 0;
};

class FrameMetrics {
 public:
  void Record(std::chrono::steady_clock::time_point frame_time);
  bool TakeDueSummary(std::chrono::steady_clock::time_point now,
                      FrameTimingSummary* output);
  FrameTimingSummary Summarize() const;

 private:
  std::chrono::steady_clock::time_point previous_frame_{};
  std::chrono::steady_clock::time_point last_report_{};
  std::vector<double> samples_;
};

}  // namespace cursor_host

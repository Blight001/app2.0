#include "frame_metrics.h"

#include <algorithm>
#include <numeric>

namespace cursor_host {
namespace {

double Percentile(const std::vector<double>& sorted, double percentile) {
  if (sorted.empty()) return 0;
  const std::size_t index = static_cast<std::size_t>(
      (sorted.size() - 1) * percentile);
  return sorted[index];
}

}  // namespace

void FrameMetrics::Record(
    std::chrono::steady_clock::time_point frame_time) {
  if (previous_frame_ != std::chrono::steady_clock::time_point{}) {
    const double milliseconds =
        std::chrono::duration<double, std::milli>(
            frame_time - previous_frame_).count();
    if (milliseconds > 0 && milliseconds < 1000) {
      if (samples_.size() >= 2048) samples_.erase(samples_.begin());
      samples_.push_back(milliseconds);
    }
  }
  previous_frame_ = frame_time;
  if (last_report_ == std::chrono::steady_clock::time_point{}) {
    last_report_ = frame_time;
  }
}

bool FrameMetrics::TakeDueSummary(
    std::chrono::steady_clock::time_point now,
    FrameTimingSummary* output) {
  if (!output || samples_.size() < 30 ||
      now - last_report_ < std::chrono::seconds(10)) {
    return false;
  }
  *output = Summarize();
  samples_.clear();
  last_report_ = now;
  return true;
}

FrameTimingSummary FrameMetrics::Summarize() const {
  if (samples_.empty()) return {};
  std::vector<double> sorted = samples_;
  std::sort(sorted.begin(), sorted.end());
  return FrameTimingSummary{
      sorted.size(),
      std::accumulate(sorted.begin(), sorted.end(), 0.0) / sorted.size(),
      Percentile(sorted, 0.95),
      Percentile(sorted, 0.99),
  };
}

}  // namespace cursor_host

#pragma once

#include <windows.h>

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace cursor_host {

struct DecodedCursorFrame {
  UINT width = 0;
  UINT height = 0;
  POINT hotspot{};
  std::vector<std::uint8_t> pixels;
};

class CursorAssetCache {
 public:
  bool LoadAni(const std::wstring& path);
  const DecodedCursorFrame* FrameAt(
      std::chrono::steady_clock::time_point now, std::size_t* frame_index) const;
  bool animated() const { return false; }
  bool empty() const { return frames_.empty(); }
  const std::vector<DecodedCursorFrame>& frames() const { return frames_; }

 private:
  bool DecodeIcon(const std::uint8_t* data, std::size_t size);
  bool ParseChunks(const std::vector<std::uint8_t>& file);

  std::vector<DecodedCursorFrame> frames_;
};

}  // namespace cursor_host

#include "cursor_asset_cache.h"

#include <wincodec.h>
#include <wrl/client.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <fstream>
#include <iterator>
#include <climits>

namespace cursor_host {
namespace {

constexpr std::size_t kMaximumAssetBytes = 16 * 1024 * 1024;

std::uint32_t ReadU32(const std::uint8_t* data) {
  std::uint32_t value = 0;
  memcpy(&value, data, sizeof(value));
  return value;
}

std::uint16_t ReadU16(const std::uint8_t* data) {
  std::uint16_t value = 0;
  memcpy(&value, data, sizeof(value));
  return value;
}

bool FourCc(const std::uint8_t* data, const char* expected) {
  return memcmp(data, expected, 4) == 0;
}

POINT IconHotspot(const std::uint8_t* data, std::size_t size) {
  if (size < 22 || ReadU16(data) != 0 || ReadU16(data + 4) == 0) return {};
  if (ReadU16(data + 2) == 2) {
    return POINT{
        static_cast<LONG>(ReadU16(data + 10)),
        static_cast<LONG>(ReadU16(data + 12)),
    };
  }
  return POINT{
      static_cast<LONG>(data[6] ? data[6] / 2 : 16),
      static_cast<LONG>(data[7] ? data[7] / 2 : 16),
  };
}

}  // namespace

bool CursorAssetCache::LoadAni(const std::wstring& path) {
  frames_.clear();
  sequence_.clear();
  durations_.clear();
  total_duration_ = std::chrono::milliseconds(0);
  std::ifstream stream(path, std::ios::binary);
  if (!stream) return false;
  const std::istreambuf_iterator<char> begin(stream);
  const std::istreambuf_iterator<char> end;
  std::vector<std::uint8_t> file(begin, end);
  if (file.size() < 12 || file.size() > kMaximumAssetBytes ||
      !FourCc(file.data(), "RIFF") || !FourCc(file.data() + 8, "ACON")) {
    return false;
  }
  if (!ParseChunks(file) || frames_.empty()) return false;
  if (sequence_.empty()) {
    for (std::size_t index = 0; index < frames_.size(); ++index) {
      sequence_.push_back(index);
    }
  }
  if (durations_.size() < sequence_.size()) {
    durations_.resize(sequence_.size(), std::chrono::milliseconds(100));
  }
  for (const auto duration : durations_) total_duration_ += duration;
  started_at_ = std::chrono::steady_clock::now();
  return total_duration_.count() > 0;
}

bool CursorAssetCache::ParseChunks(const std::vector<std::uint8_t>& file) {
  std::uint32_t default_jiffies = 6;
  std::vector<std::uint32_t> rate;
  std::vector<std::uint32_t> sequence;
  for (std::size_t cursor = 12; cursor + 8 <= file.size();) {
    const std::uint8_t* header = file.data() + cursor;
    const std::uint32_t size = ReadU32(header + 4);
    const std::size_t data_start = cursor + 8;
    const std::size_t data_end = data_start + size;
    if (data_end > file.size()) return false;
    if (FourCc(header, "anih") && size >= 36) {
      default_jiffies = std::max(1u, ReadU32(file.data() + data_start + 28));
    } else if (FourCc(header, "rate")) {
      for (std::size_t offset = 0; offset + 4 <= size; offset += 4) {
        rate.push_back(std::max(1u, ReadU32(file.data() + data_start + offset)));
      }
    } else if (FourCc(header, "seq ")) {
      for (std::size_t offset = 0; offset + 4 <= size; offset += 4) {
        sequence.push_back(ReadU32(file.data() + data_start + offset));
      }
    } else if (FourCc(header, "LIST") && size >= 4 &&
               FourCc(file.data() + data_start, "fram")) {
      std::size_t nested = data_start + 4;
      while (nested + 8 <= data_end) {
        const std::uint32_t nested_size = ReadU32(file.data() + nested + 4);
        const std::size_t nested_data = nested + 8;
        if (nested_data + nested_size > data_end) return false;
        if (FourCc(file.data() + nested, "icon")) {
          DecodeIcon(file.data() + nested_data, nested_size);
        }
        nested = nested_data + nested_size + (nested_size & 1);
      }
    }
    cursor = data_end + (size & 1);
  }
  for (const std::uint32_t index : sequence) {
    if (index < frames_.size()) sequence_.push_back(index);
  }
  const std::size_t steps = sequence_.empty() ? frames_.size() : sequence_.size();
  for (std::size_t index = 0; index < steps; ++index) {
    const std::uint32_t jiffies = index < rate.size() ? rate[index] : default_jiffies;
    durations_.push_back(std::chrono::milliseconds(
        std::max(1u, static_cast<std::uint32_t>(
            std::lround(jiffies * 1000.0 / 60.0)))));
  }
  return true;
}

bool CursorAssetCache::DecodeIcon(
    const std::uint8_t* data, std::size_t size) {
  if (!data || !size || size > UINT_MAX) return false;
  Microsoft::WRL::ComPtr<IWICImagingFactory> factory;
  Microsoft::WRL::ComPtr<IWICStream> stream;
  Microsoft::WRL::ComPtr<IWICBitmapDecoder> decoder;
  Microsoft::WRL::ComPtr<IWICBitmapFrameDecode> frame;
  Microsoft::WRL::ComPtr<IWICFormatConverter> converter;
  HRESULT result = CoCreateInstance(
      CLSID_WICImagingFactory, nullptr, CLSCTX_INPROC_SERVER,
      IID_PPV_ARGS(&factory));
  if (SUCCEEDED(result)) result = factory->CreateStream(&stream);
  if (SUCCEEDED(result)) {
    result = stream->InitializeFromMemory(
        const_cast<BYTE*>(data), static_cast<DWORD>(size));
  }
  if (SUCCEEDED(result)) {
    result = factory->CreateDecoderFromStream(
        stream.Get(), nullptr, WICDecodeMetadataCacheOnLoad, &decoder);
  }
  if (SUCCEEDED(result)) result = decoder->GetFrame(0, &frame);
  if (SUCCEEDED(result)) result = factory->CreateFormatConverter(&converter);
  if (SUCCEEDED(result)) {
    result = converter->Initialize(
        frame.Get(), GUID_WICPixelFormat32bppPBGRA,
        WICBitmapDitherTypeNone, nullptr, 0.0, WICBitmapPaletteTypeCustom);
  }
  DecodedCursorFrame output;
  if (SUCCEEDED(result)) result = converter->GetSize(&output.width, &output.height);
  if (FAILED(result) || !output.width || !output.height ||
      output.width > 256 || output.height > 256) {
    return false;
  }
  const UINT stride = output.width * 4;
  output.pixels.resize(static_cast<std::size_t>(stride) * output.height);
  result = converter->CopyPixels(
      nullptr, stride, static_cast<UINT>(output.pixels.size()),
      output.pixels.data());
  if (FAILED(result)) return false;
  output.hotspot = IconHotspot(data, size);
  frames_.push_back(std::move(output));
  return true;
}

const DecodedCursorFrame* CursorAssetCache::FrameAt(
    std::chrono::steady_clock::time_point now,
    std::size_t* frame_index) const {
  if (frames_.empty() || sequence_.empty()) return nullptr;
  auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
      now - started_at_);
  std::int64_t remaining = total_duration_.count()
      ? elapsed.count() % total_duration_.count()
      : 0;
  std::size_t step = 0;
  while (step + 1 < durations_.size() &&
         remaining >= durations_[step].count()) {
    remaining -= durations_[step].count();
    ++step;
  }
  const std::size_t index = sequence_[std::min(step, sequence_.size() - 1)];
  if (frame_index) *frame_index = index;
  return index < frames_.size() ? &frames_[index] : nullptr;
}

}  // namespace cursor_host

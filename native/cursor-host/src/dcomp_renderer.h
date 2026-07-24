#pragma once

#include <windows.h>

#include <d2d1_1.h>
#include <d3d11.h>
#include <dcomp.h>
#include <wrl/client.h>

#include <cstddef>
#include <vector>

#include "cursor_asset_cache.h"

namespace cursor_host {

class DCompRenderer {
 public:
  DCompRenderer() = default;
  ~DCompRenderer();
  bool Initialize(HWND owner, const std::wstring& cursor_asset_path = L"");
  bool Recover();
  bool RenderAt(POINT screen_position, double feedback_progress = -1.0);
  void Hide();
  HWND window() const { return window_; }
  bool initialized() const { return window_ != nullptr; }
  bool has_committed_frame() const { return has_committed_frame_; }
  bool device_lost() const { return device_lost_; }

 private:
  static LRESULT CALLBACK WindowProc(
      HWND window, UINT message, WPARAM wparam, LPARAM lparam);
  bool CreateOverlayWindow(HWND owner);
  bool CreateDevices();
  bool CreateSurface();
  bool CreateAssetBitmaps(const std::wstring& path);
  bool DrawCursor(double feedback_progress = -1.0);
  void Reset();

  HWND window_ = nullptr;
  bool visible_ = false;
  bool has_committed_frame_ = false;
  bool feedback_was_visible_ = false;
  bool device_lost_ = false;
  HWND owner_ = nullptr;
  std::wstring cursor_asset_path_;
  POINT current_hotspot_{7, 5};
  std::size_t last_asset_frame_ = SIZE_MAX;
  CursorAssetCache asset_cache_;
  std::vector<Microsoft::WRL::ComPtr<ID2D1Bitmap1>> asset_bitmaps_;
  Microsoft::WRL::ComPtr<ID3D11Device> d3d_device_;
  Microsoft::WRL::ComPtr<ID2D1Factory1> d2d_factory_;
  Microsoft::WRL::ComPtr<ID2D1Device> d2d_device_;
  Microsoft::WRL::ComPtr<ID2D1DeviceContext> d2d_context_;
  Microsoft::WRL::ComPtr<IDCompositionDevice> composition_device_;
  Microsoft::WRL::ComPtr<IDCompositionTarget> composition_target_;
  Microsoft::WRL::ComPtr<IDCompositionVisual> root_visual_;
  Microsoft::WRL::ComPtr<IDCompositionSurface> surface_;
};

}  // namespace cursor_host

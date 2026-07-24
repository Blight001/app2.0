#pragma once

#include <windows.h>

#include <d2d1_1.h>
#include <d3d11.h>
#include <dcomp.h>
#include <wrl/client.h>

namespace cursor_host {

class DCompRenderer {
 public:
  DCompRenderer() = default;
  ~DCompRenderer();
  bool Initialize(HWND owner);
  bool RenderAt(POINT screen_position);
  void Hide();
  HWND window() const { return window_; }
  bool has_committed_frame() const { return has_committed_frame_; }

 private:
  static LRESULT CALLBACK WindowProc(
      HWND window, UINT message, WPARAM wparam, LPARAM lparam);
  bool CreateOverlayWindow(HWND owner);
  bool CreateDevices();
  bool CreateSurface();
  bool DrawCursor();
  void Reset();

  HWND window_ = nullptr;
  bool visible_ = false;
  bool has_committed_frame_ = false;
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

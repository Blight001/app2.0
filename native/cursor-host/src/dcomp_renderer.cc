#include "dcomp_renderer.h"

#include <d2d1helper.h>
#include <dwmapi.h>
#include <dxgi1_2.h>

namespace cursor_host {
namespace {

constexpr int kSurfaceSize = 48;
constexpr int kHotspotX = 7;
constexpr int kHotspotY = 5;
constexpr wchar_t kWindowClass[] = L"AI_FREE_CURSOR_HOST_OVERLAY";

bool Succeeded(HRESULT result) { return SUCCEEDED(result); }

}  // namespace

DCompRenderer::~DCompRenderer() { Reset(); }

bool DCompRenderer::Initialize(HWND owner) {
  return CreateOverlayWindow(owner) && CreateDevices() && CreateSurface() &&
      DrawCursor();
}

bool DCompRenderer::RenderAt(POINT screen_position) {
  if (!window_ || !has_committed_frame_) return false;
  const int x = screen_position.x - kHotspotX;
  const int y = screen_position.y - kHotspotY;
  if (!SetWindowPos(window_, HWND_TOP, x, y, kSurfaceSize, kSurfaceSize,
                    SWP_NOACTIVATE | SWP_SHOWWINDOW)) {
    return false;
  }
  visible_ = true;
  DwmFlush();
  return true;
}

void DCompRenderer::Hide() {
  if (window_ && visible_) ShowWindow(window_, SW_HIDE);
  visible_ = false;
}

LRESULT CALLBACK DCompRenderer::WindowProc(
    HWND window, UINT message, WPARAM wparam, LPARAM lparam) {
  if (message == WM_NCHITTEST) return HTTRANSPARENT;
  if (message == WM_MOUSEACTIVATE) return MA_NOACTIVATE;
  if (message == WM_ERASEBKGND) return 1;
  return DefWindowProcW(window, message, wparam, lparam);
}

bool DCompRenderer::CreateOverlayWindow(HWND owner) {
  WNDCLASSEXW window_class{sizeof(window_class)};
  window_class.lpfnWndProc = &DCompRenderer::WindowProc;
  window_class.hInstance = GetModuleHandleW(nullptr);
  window_class.lpszClassName = kWindowClass;
  RegisterClassExW(&window_class);
  window_ = CreateWindowExW(
      WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT |
          WS_EX_NOREDIRECTIONBITMAP,
      kWindowClass, L"", WS_POPUP, 0, 0, kSurfaceSize, kSurfaceSize, owner,
      nullptr, window_class.hInstance, nullptr);
  if (!window_) return false;
  return true;
}

bool DCompRenderer::CreateDevices() {
  UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
  D3D_FEATURE_LEVEL level{};
  const D3D_FEATURE_LEVEL levels[] = {
      D3D_FEATURE_LEVEL_11_1, D3D_FEATURE_LEVEL_11_0,
      D3D_FEATURE_LEVEL_10_1, D3D_FEATURE_LEVEL_10_0};
  if (!Succeeded(D3D11CreateDevice(
          nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags, levels,
          ARRAYSIZE(levels), D3D11_SDK_VERSION, &d3d_device_, &level,
          nullptr))) {
    return false;
  }
  Microsoft::WRL::ComPtr<IDXGIDevice> dxgi_device;
  if (!Succeeded(d3d_device_.As(&dxgi_device)) ||
      !Succeeded(D2D1CreateFactory(
          D2D1_FACTORY_TYPE_SINGLE_THREADED, d2d_factory_.GetAddressOf())) ||
      !Succeeded(d2d_factory_->CreateDevice(
          dxgi_device.Get(), &d2d_device_)) ||
      !Succeeded(d2d_device_->CreateDeviceContext(
          D2D1_DEVICE_CONTEXT_OPTIONS_NONE, &d2d_context_)) ||
      !Succeeded(DCompositionCreateDevice(
          dxgi_device.Get(), IID_PPV_ARGS(&composition_device_))) ||
      !Succeeded(composition_device_->CreateTargetForHwnd(
          window_, TRUE, &composition_target_)) ||
      !Succeeded(composition_device_->CreateVisual(&root_visual_))) {
    return false;
  }
  return Succeeded(composition_target_->SetRoot(root_visual_.Get()));
}

bool DCompRenderer::CreateSurface() {
  if (!Succeeded(composition_device_->CreateSurface(
          kSurfaceSize, kSurfaceSize, DXGI_FORMAT_B8G8R8A8_UNORM,
          DXGI_ALPHA_MODE_PREMULTIPLIED, &surface_)) ||
      !Succeeded(root_visual_->SetContent(surface_.Get())) ||
      !Succeeded(composition_device_->Commit())) {
    return false;
  }
  return true;
}

bool DCompRenderer::DrawCursor() {
  POINT offset{};
  Microsoft::WRL::ComPtr<IDXGISurface> dxgi_surface;
  if (!Succeeded(surface_->BeginDraw(
          nullptr, IID_PPV_ARGS(&dxgi_surface), &offset))) {
    return false;
  }
  D2D1_BITMAP_PROPERTIES1 properties = D2D1::BitmapProperties1(
      D2D1_BITMAP_OPTIONS_TARGET | D2D1_BITMAP_OPTIONS_CANNOT_DRAW,
      D2D1::PixelFormat(
          DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED));
  Microsoft::WRL::ComPtr<ID2D1Bitmap1> target;
  HRESULT result = d2d_context_->CreateBitmapFromDxgiSurface(
      dxgi_surface.Get(), &properties, &target);
  if (Succeeded(result)) {
    d2d_context_->SetTarget(target.Get());
    d2d_context_->BeginDraw();
    d2d_context_->Clear(D2D1::ColorF(0, 0));
    Microsoft::WRL::ComPtr<ID2D1SolidColorBrush> fill;
    Microsoft::WRL::ComPtr<ID2D1SolidColorBrush> outline;
    result = d2d_context_->CreateSolidColorBrush(
        D2D1::ColorF(0.18f, 0.67f, 1.0f, 1.0f), &fill);
    if (Succeeded(result)) {
      result = d2d_context_->CreateSolidColorBrush(
          D2D1::ColorF(0.02f, 0.08f, 0.14f, 0.95f), &outline);
    }
    const D2D1_ELLIPSE body = D2D1::Ellipse(
        D2D1::Point2F(18.0f, 17.0f), 10.0f, 10.0f);
    if (Succeeded(result)) {
      d2d_context_->FillEllipse(body, fill.Get());
      d2d_context_->DrawEllipse(body, outline.Get(), 2.0f);
      d2d_context_->DrawLine(
          D2D1::Point2F(7.0f, 5.0f), D2D1::Point2F(12.0f, 10.0f),
          fill.Get(), 4.0f);
      result = d2d_context_->EndDraw();
    }
  }
  surface_->EndDraw();
  if (!Succeeded(result) || !Succeeded(composition_device_->Commit())) {
    return false;
  }
  has_committed_frame_ = true;
  return true;
}

void DCompRenderer::Reset() {
  Hide();
  surface_.Reset();
  root_visual_.Reset();
  composition_target_.Reset();
  composition_device_.Reset();
  d2d_context_.Reset();
  d2d_device_.Reset();
  d2d_factory_.Reset();
  d3d_device_.Reset();
  if (window_) DestroyWindow(window_);
  window_ = nullptr;
  has_committed_frame_ = false;
}

}  // namespace cursor_host

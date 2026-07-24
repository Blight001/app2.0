#include "dcomp_renderer.h"

#include <d2d1helper.h>
#include <dwmapi.h>
#include <dxgi1_2.h>

#include <algorithm>
#include <cmath>

namespace cursor_host {
namespace {

constexpr int kSurfaceSize = 64;
constexpr float kCursorScale = 0.75f;
constexpr auto kMinEffectRedrawInterval = std::chrono::milliseconds(11);
constexpr wchar_t kWindowClass[] = L"AI_FREE_CURSOR_HOST_OVERLAY";

bool Succeeded(HRESULT result) { return SUCCEEDED(result); }

float CursorScaled(float value) { return value * kCursorScale; }

float EaseOutQuad(float t) {
  const float clamped = std::clamp(t, 0.0f, 1.0f);
  return 1.0f - (1.0f - clamped) * (1.0f - clamped);
}

}  // namespace

DCompRenderer::~DCompRenderer() { Reset(); }

bool DCompRenderer::Initialize(const std::wstring& cursor_asset_path) {
  cursor_asset_path_ = cursor_asset_path;
  device_lost_ = false;
  return CreateOverlayWindow() && CreateDevices() && CreateSurface() &&
      CreateAssetBitmaps(cursor_asset_path) && DrawCursor();
}

bool DCompRenderer::Recover() {
  const std::wstring asset_path = cursor_asset_path_;
  Reset();
  return Initialize(asset_path);
}

bool DCompRenderer::RenderAt(
    POINT screen_position, PointerButton button, bool dragging,
    double effect_progress) {
  if (!window_ || !has_committed_frame_) return false;
  const auto now = std::chrono::steady_clock::now();
  std::size_t asset_frame = SIZE_MAX;
  asset_cache_.FrameAt(now, &asset_frame);
  const bool asset_changed = asset_frame != last_asset_frame_;
  const bool effect_active = effect_progress >= 0.0;
  const bool effect_was_active = last_effect_progress_ >= 0.0;
  const bool becoming_visible = !visible_;
  const bool discrete_change = becoming_visible || asset_changed ||
      button != last_button_ || dragging != last_dragging_ ||
      effect_active != effect_was_active;
  bool should_redraw = discrete_change;
  if (!should_redraw && effect_active) {
    // Cap click-effect surface redraws near display refresh to avoid strobing.
    should_redraw = (now - last_draw_at_) >= kMinEffectRedrawInterval;
  }
  if (should_redraw) {
    if (!DrawCursor(button, dragging, effect_progress)) return false;
    last_draw_at_ = now;
    last_button_ = button;
    last_dragging_ = dragging;
    last_effect_progress_ = effect_progress;
  }
  const int x = screen_position.x - current_hotspot_.x;
  const int y = screen_position.y - current_hotspot_.y;
  // Always reassert HWND_TOPMOST. Skipping this when the cursor is still lets
  // Chromium/Electron windows cover the overlay and makes the cursor "disappear".
  UINT flags = SWP_NOACTIVATE;
  if (!visible_) flags |= SWP_SHOWWINDOW;
  if (!SetWindowPos(window_, HWND_TOPMOST, x, y, kSurfaceSize, kSurfaceSize,
                    flags)) {
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

bool DCompRenderer::CreateOverlayWindow() {
  WNDCLASSEXW window_class{sizeof(window_class)};
  window_class.lpfnWndProc = &DCompRenderer::WindowProc;
  window_class.hInstance = GetModuleHandleW(nullptr);
  window_class.lpszClassName = kWindowClass;
  RegisterClassExW(&window_class);
  window_ = CreateWindowExW(
      WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW | WS_EX_TRANSPARENT |
      WS_EX_NOREDIRECTIONBITMAP,
      kWindowClass, L"", WS_POPUP, 0, 0, kSurfaceSize, kSurfaceSize, nullptr,
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

bool DCompRenderer::CreateAssetBitmaps(const std::wstring& path) {
  if (path.empty() || !asset_cache_.LoadAni(path)) return true;
  for (const DecodedCursorFrame& frame : asset_cache_.frames()) {
    D2D1_BITMAP_PROPERTIES1 properties = D2D1::BitmapProperties1(
        D2D1_BITMAP_OPTIONS_NONE,
        D2D1::PixelFormat(
            DXGI_FORMAT_B8G8R8A8_UNORM, D2D1_ALPHA_MODE_PREMULTIPLIED));
    Microsoft::WRL::ComPtr<ID2D1Bitmap1> bitmap;
    const HRESULT result = d2d_context_->CreateBitmap(
        D2D1::SizeU(frame.width, frame.height), frame.pixels.data(),
        frame.width * 4, &properties, &bitmap);
    if (FAILED(result)) {
      asset_bitmaps_.clear();
      return true;
    }
    asset_bitmaps_.push_back(std::move(bitmap));
  }
  return true;
}

bool DCompRenderer::DrawCursor(
    PointerButton button, bool dragging, double effect_progress) {
  POINT offset{};
  Microsoft::WRL::ComPtr<IDXGISurface> dxgi_surface;
  if (!Succeeded(surface_->BeginDraw(
          nullptr, IID_PPV_ARGS(&dxgi_surface), &offset))) {
    device_lost_ = true;
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
    std::size_t asset_frame = SIZE_MAX;
    const DecodedCursorFrame* decoded = asset_cache_.FrameAt(
        std::chrono::steady_clock::now(), &asset_frame);
    const bool has_asset = decoded && asset_frame < asset_bitmaps_.size();
    if (has_asset) {
      const float scale = std::min(
          1.0f, std::min(
              static_cast<float>(kSurfaceSize) / decoded->width,
              static_cast<float>(kSurfaceSize) / decoded->height)) *
          kCursorScale;
      const D2D1_RECT_F destination = D2D1::RectF(
          0, 0, decoded->width * scale, decoded->height * scale);
      d2d_context_->DrawBitmap(
          asset_bitmaps_[asset_frame].Get(), destination, 1.0f,
          D2D1_INTERPOLATION_MODE_HIGH_QUALITY_CUBIC);
      current_hotspot_ = POINT{
          static_cast<LONG>(std::lround(decoded->hotspot.x * scale)),
          static_cast<LONG>(std::lround(decoded->hotspot.y * scale)),
      };
      last_asset_frame_ = asset_frame;
    }
    if (!has_asset) {
      Microsoft::WRL::ComPtr<ID2D1SolidColorBrush> fill;
      Microsoft::WRL::ComPtr<ID2D1SolidColorBrush> outline;
      result = d2d_context_->CreateSolidColorBrush(
          D2D1::ColorF(0.18f, 0.67f, 1.0f, 1.0f), &fill);
      if (Succeeded(result)) {
        result = d2d_context_->CreateSolidColorBrush(
            D2D1::ColorF(0.02f, 0.08f, 0.14f, 0.95f), &outline);
      }
      const D2D1_ELLIPSE body = D2D1::Ellipse(
          D2D1::Point2F(CursorScaled(18.0f), CursorScaled(17.0f)),
          CursorScaled(10.0f), CursorScaled(10.0f));
      if (Succeeded(result)) {
        d2d_context_->FillEllipse(body, fill.Get());
        d2d_context_->DrawEllipse(
            body, outline.Get(), CursorScaled(2.0f));
        d2d_context_->DrawLine(
            D2D1::Point2F(CursorScaled(7.0f), CursorScaled(5.0f)),
            D2D1::Point2F(CursorScaled(12.0f), CursorScaled(10.0f)),
            fill.Get(), CursorScaled(4.0f));
      }
      current_hotspot_ = POINT{
          static_cast<LONG>(std::lround(CursorScaled(7.0f))),
          static_cast<LONG>(std::lround(CursorScaled(5.0f))),
      };
    }
    const D2D1_POINT_2F center = has_asset
        ? D2D1::Point2F(
            static_cast<float>(current_hotspot_.x),
            static_cast<float>(current_hotspot_.y))
        : D2D1::Point2F(CursorScaled(18.0f), CursorScaled(17.0f));
    // Static press/drag ring (no click effect).
    if (Succeeded(result) && button != PointerButton::kNone &&
        effect_progress < 0.0) {
      Microsoft::WRL::ComPtr<ID2D1SolidColorBrush> press;
      const float opacity = dragging ? 0.70f : 0.55f;
      const D2D1_COLOR_F color = dragging
          ? D2D1::ColorF(0.20f, 0.90f, 0.45f, opacity)
          : button == PointerButton::kRight
              ? D2D1::ColorF(1.0f, 0.55f, 0.16f, opacity)
              : D2D1::ColorF(0.25f, 0.78f, 1.0f, opacity);
      result = d2d_context_->CreateSolidColorBrush(color, &press);
      if (Succeeded(result)) {
        const float radius = CursorScaled(dragging ? 8.0f : 7.0f);
        d2d_context_->DrawEllipse(
            D2D1::Ellipse(center, radius, radius), press.Get(),
            CursorScaled(1.5f));
      }
    }
    // Soft expanding click ripple: ease-out growth + quadratic fade.
    if (Succeeded(result) && effect_progress >= 0.0) {
      const float t = static_cast<float>(std::clamp(effect_progress, 0.0, 1.0));
      const float expand = EaseOutQuad(t);
      const float fade = (1.0f - t) * (1.0f - t);
      const float radius = CursorScaled(4.0f + expand * 14.0f);
      const float stroke = CursorScaled(1.8f - expand * 0.6f);
      const float fill_alpha = fade * 0.22f;
      const float stroke_alpha = fade * 0.85f;
      const bool right = button == PointerButton::kRight;
      const bool drag = dragging;
      const float cr = drag ? 0.20f : right ? 1.0f : 0.25f;
      const float cg = drag ? 0.90f : right ? 0.55f : 0.78f;
      const float cb = drag ? 0.45f : right ? 0.16f : 1.0f;
      Microsoft::WRL::ComPtr<ID2D1SolidColorBrush> fill_brush;
      Microsoft::WRL::ComPtr<ID2D1SolidColorBrush> stroke_brush;
      result = d2d_context_->CreateSolidColorBrush(
          D2D1::ColorF(cr, cg, cb, fill_alpha), &fill_brush);
      if (Succeeded(result)) {
        result = d2d_context_->CreateSolidColorBrush(
            D2D1::ColorF(cr, cg, cb, stroke_alpha), &stroke_brush);
      }
      if (Succeeded(result)) {
        const D2D1_ELLIPSE ellipse = D2D1::Ellipse(center, radius, radius);
        d2d_context_->FillEllipse(ellipse, fill_brush.Get());
        d2d_context_->DrawEllipse(ellipse, stroke_brush.Get(), stroke);
      }
    }
    const HRESULT end_result = d2d_context_->EndDraw();
    if (Succeeded(result)) result = end_result;
  }
  surface_->EndDraw();
  if (!Succeeded(result) || !Succeeded(composition_device_->Commit())) {
    device_lost_ = true;
    return false;
  }
  has_committed_frame_ = true;
  return true;
}

void DCompRenderer::Reset() {
  Hide();
  surface_.Reset();
  asset_bitmaps_.clear();
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
  last_draw_at_ = {};
  last_effect_progress_ = -1.0;
  last_button_ = PointerButton::kNone;
  last_dragging_ = false;
  last_asset_frame_ = SIZE_MAX;
}

}  // namespace cursor_host

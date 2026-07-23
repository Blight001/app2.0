#include "window_capture.h"
#include "native_helpers.h"

#include <d3d11.h>
#include <dwmapi.h>
#include <windows.graphics.capture.interop.h>
#include <windows.graphics.directx.direct3d11.interop.h>
#include <wrl/client.h>

#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Graphics.Capture.h>
#include <winrt/Windows.Graphics.DirectX.h>
#include <winrt/Windows.Graphics.DirectX.Direct3D11.h>

#include <algorithm>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;
namespace wgc = winrt::Windows::Graphics::Capture;
namespace wgd = winrt::Windows::Graphics::DirectX::Direct3D11;
namespace wgdx = winrt::Windows::Graphics::DirectX;

namespace {
constexpr int kCaptureTimeoutMs = 1500;
constexpr uint64_t kMaxCapturePixels = 3840ULL * 2160ULL;

struct CapturedFrame {
  std::vector<uint8_t> rgba;
  int width = 0;
  int height = 0;
  RECT bounds = {};
  std::wstring method;
};

class WinRtApartmentScope {
 public:
  WinRtApartmentScope() {
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
  }
  ~WinRtApartmentScope() {
    winrt::uninit_apartment();
  }
};

bool WindowBelongsToProcess(HWND window, DWORD expected_pid) {
  if (!IsWindow(window)) return false;
  DWORD actual_pid = 0;
  GetWindowThreadProcessId(window, &actual_pid);
  return actual_pid == expected_pid;
}

bool IsOwnedBy(HWND window, HWND expected_owner) {
  HWND owner = GetWindow(window, GW_OWNER);
  for (int depth = 0; owner && depth < 16; ++depth) {
    if (owner == expected_owner) return true;
    owner = GetWindow(owner, GW_OWNER);
  }
  return false;
}

struct PopupSearch {
  HWND child;
  DWORD pid;
  HWND found;
};

BOOL CALLBACK FindOwnedPopup(HWND candidate, LPARAM parameter) {
  auto* search = reinterpret_cast<PopupSearch*>(parameter);
  if (candidate == search->child || !IsWindowVisible(candidate)
      || !WindowBelongsToProcess(candidate, search->pid)
      || !IsOwnedBy(candidate, search->child)) return TRUE;
  search->found = candidate;
  return FALSE;
}

HWND ResolveCaptureWindow(HWND child, DWORD expected_pid) {
  const HWND popup = GetLastActivePopup(child);
  if (popup != child && IsWindowVisible(popup)
      && WindowBelongsToProcess(popup, expected_pid)
      && IsOwnedBy(popup, child)) {
    SetWindowPos(
        popup, HWND_TOP, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
    return popup;
  }
  PopupSearch search = { child, expected_pid, nullptr };
  EnumWindows(FindOwnedPopup, reinterpret_cast<LPARAM>(&search));
  if (search.found) {
    SetWindowPos(
        search.found, HWND_TOP, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
  }
  return search.found ? search.found : child;
}

bool ValidateTarget(HWND child, DWORD expected_pid, std::string* error) {
  if (!IsWindow(child)) {
    *error = "bound software window is no longer available";
    return false;
  }
  DWORD actual_pid = 0;
  GetWindowThreadProcessId(child, &actual_pid);
  if (!expected_pid || actual_pid != expected_pid) {
    *error = "bound software window identity has changed";
    return false;
  }
  DWORD current_session = 0;
  DWORD child_session = 0;
  ProcessIdToSessionId(GetCurrentProcessId(), &current_session);
  ProcessIdToSessionId(actual_pid, &child_session);
  if (current_session != child_session) {
    *error = "cross-session window capture is forbidden";
    return false;
  }
  return true;
}

RECT CaptureBounds(HWND window) {
  RECT bounds = {};
  if (FAILED(DwmGetWindowAttribute(
      window, DWMWA_EXTENDED_FRAME_BOUNDS, &bounds, sizeof(bounds)))) {
    GetWindowRect(window, &bounds);
  }
  return bounds;
}

bool ValidDimensions(int width, int height) {
  return width > 0 && height > 0
      && static_cast<uint64_t>(width) * static_cast<uint64_t>(height)
          <= kMaxCapturePixels;
}

wgd::IDirect3DDevice CreateWinRtDevice(
    ComPtr<ID3D11Device>* d3d_device,
    ComPtr<ID3D11DeviceContext>* context) {
  UINT flags = D3D11_CREATE_DEVICE_BGRA_SUPPORT;
  D3D_FEATURE_LEVEL level;
  HRESULT result = D3D11CreateDevice(
      nullptr, D3D_DRIVER_TYPE_HARDWARE, nullptr, flags,
      nullptr, 0, D3D11_SDK_VERSION, d3d_device->GetAddressOf(),
      &level, context->GetAddressOf());
  if (FAILED(result)) {
    winrt::check_hresult(D3D11CreateDevice(
        nullptr, D3D_DRIVER_TYPE_WARP, nullptr, flags,
        nullptr, 0, D3D11_SDK_VERSION, d3d_device->ReleaseAndGetAddressOf(),
        &level, context->ReleaseAndGetAddressOf()));
  }
  ComPtr<IDXGIDevice> dxgi_device;
  winrt::check_hresult(d3d_device->As(&dxgi_device));
  ComPtr<IInspectable> inspectable;
  winrt::check_hresult(CreateDirect3D11DeviceFromDXGIDevice(
      dxgi_device.Get(), inspectable.GetAddressOf()));
  return wgd::IDirect3DDevice{
    inspectable.Detach(), winrt::take_ownership_from_abi
  };
}

wgc::GraphicsCaptureItem CreateCaptureItem(HWND window) {
  auto interop = winrt::get_activation_factory<
      wgc::GraphicsCaptureItem, IGraphicsCaptureItemInterop>();
  wgc::GraphicsCaptureItem item = nullptr;
  winrt::check_hresult(interop->CreateForWindow(
      window, winrt::guid_of<wgc::GraphicsCaptureItem>(), winrt::put_abi(item)));
  return item;
}

void CopyTexture(
    ID3D11Device* device, ID3D11DeviceContext* context,
    ID3D11Texture2D* texture, int width, int height,
    std::vector<uint8_t>* output) {
  D3D11_TEXTURE2D_DESC desc = {};
  texture->GetDesc(&desc);
  desc.Width = width;
  desc.Height = height;
  desc.BindFlags = 0;
  desc.MiscFlags = 0;
  desc.Usage = D3D11_USAGE_STAGING;
  desc.CPUAccessFlags = D3D11_CPU_ACCESS_READ;
  ComPtr<ID3D11Texture2D> staging;
  winrt::check_hresult(device->CreateTexture2D(&desc, nullptr, &staging));
  context->CopyResource(staging.Get(), texture);
  D3D11_MAPPED_SUBRESOURCE mapped = {};
  winrt::check_hresult(context->Map(staging.Get(), 0, D3D11_MAP_READ, 0, &mapped));
  output->resize(static_cast<size_t>(width) * height * 4);
  for (int y = 0; y < height; ++y) {
    const auto* source = static_cast<const uint8_t*>(mapped.pData)
        + static_cast<size_t>(y) * mapped.RowPitch;
    auto* target = output->data() + static_cast<size_t>(y) * width * 4;
    for (int x = 0; x < width; ++x) {
      target[x * 4] = source[x * 4 + 2];
      target[x * 4 + 1] = source[x * 4 + 1];
      target[x * 4 + 2] = source[x * 4];
      target[x * 4 + 3] = source[x * 4 + 3];
    }
  }
  context->Unmap(staging.Get(), 0);
}

CapturedFrame CaptureWithGraphicsCapture(HWND window) {
  WinRtApartmentScope apartment;
  ComPtr<ID3D11Device> d3d_device;
  ComPtr<ID3D11DeviceContext> context;
  const wgd::IDirect3DDevice winrt_device = CreateWinRtDevice(
      &d3d_device, &context);
  const wgc::GraphicsCaptureItem item = CreateCaptureItem(window);
  const auto size = item.Size();
  if (!ValidDimensions(size.Width, size.Height)) {
    throw winrt::hresult_invalid_argument(L"capture window dimensions are invalid");
  }
  const wgc::Direct3D11CaptureFramePool pool =
      wgc::Direct3D11CaptureFramePool::CreateFreeThreaded(
          winrt_device, wgdx::DirectXPixelFormat::B8G8R8A8UIntNormalized, 1, size);
  const wgc::GraphicsCaptureSession session = pool.CreateCaptureSession(item);
  const HANDLE ready = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  if (!ready) throw winrt::hresult_error(HRESULT_FROM_WIN32(GetLastError()));
  const auto token = pool.FrameArrived([ready](auto&&, auto&&) {
    SetEvent(ready);
  });
  session.StartCapture();
  const DWORD wait_result = WaitForSingleObject(ready, kCaptureTimeoutMs);
  pool.FrameArrived(token);
  CloseHandle(ready);
  if (wait_result != WAIT_OBJECT_0) {
    throw winrt::hresult_error(HRESULT_FROM_WIN32(ERROR_TIMEOUT));
  }
  const wgc::Direct3D11CaptureFrame frame = pool.TryGetNextFrame();
  if (!frame) throw winrt::hresult_error(E_FAIL, L"no capture frame was returned");
  const auto content_size = frame.ContentSize();
  if (!ValidDimensions(content_size.Width, content_size.Height)) {
    throw winrt::hresult_invalid_argument(L"capture frame dimensions are invalid");
  }
  auto access = frame.Surface().as<
      ::Windows::Graphics::DirectX::Direct3D11::IDirect3DDxgiInterfaceAccess>();
  ComPtr<ID3D11Texture2D> texture;
  winrt::check_hresult(access->GetInterface(IID_PPV_ARGS(&texture)));
  CapturedFrame output;
  output.width = content_size.Width;
  output.height = content_size.Height;
  output.bounds = CaptureBounds(window);
  output.method = L"windows_graphics_capture";
  CopyTexture(
      d3d_device.Get(), context.Get(), texture.Get(),
      output.width, output.height, &output.rgba);
  session.Close();
  pool.Close();
  return output;
}

CapturedFrame CaptureWithPrintWindow(HWND window) {
  const RECT bounds = CaptureBounds(window);
  const int width = bounds.right - bounds.left;
  const int height = bounds.bottom - bounds.top;
  if (!ValidDimensions(width, height)) {
    throw std::runtime_error("capture window dimensions are invalid");
  }
  HDC screen = GetDC(nullptr);
  HDC memory = CreateCompatibleDC(screen);
  BITMAPINFO info = {};
  info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  info.bmiHeader.biWidth = width;
  info.bmiHeader.biHeight = -height;
  info.bmiHeader.biPlanes = 1;
  info.bmiHeader.biBitCount = 32;
  info.bmiHeader.biCompression = BI_RGB;
  void* pixels = nullptr;
  HBITMAP bitmap = CreateDIBSection(
      screen, &info, DIB_RGB_COLORS, &pixels, nullptr, 0);
  if (!screen || !memory || !bitmap || !pixels) {
    if (bitmap) DeleteObject(bitmap);
    if (memory) DeleteDC(memory);
    if (screen) ReleaseDC(nullptr, screen);
    throw std::runtime_error("unable to allocate window capture bitmap");
  }
  const HGDIOBJ previous = SelectObject(memory, bitmap);
  const BOOL rendered = PrintWindow(window, memory, 2);
  CapturedFrame output;
  if (rendered) {
    output.width = width;
    output.height = height;
    output.bounds = bounds;
    output.method = L"print_window_fallback";
    output.rgba.resize(static_cast<size_t>(width) * height * 4);
    const auto* source = static_cast<const uint8_t*>(pixels);
    for (size_t index = 0; index < output.rgba.size(); index += 4) {
      output.rgba[index] = source[index + 2];
      output.rgba[index + 1] = source[index + 1];
      output.rgba[index + 2] = source[index];
      output.rgba[index + 3] = 255;
    }
  }
  SelectObject(memory, previous);
  DeleteObject(bitmap);
  DeleteDC(memory);
  ReleaseDC(nullptr, screen);
  if (!rendered) throw std::runtime_error("PrintWindow did not render the target");
  return output;
}

void SetNamed(napi_env env, napi_value object, const char* name, napi_value value) {
  napi_set_named_property(env, object, name, value);
}

napi_value IntValue(napi_env env, int value) {
  napi_value result;
  napi_create_int32(env, value, &result);
  return result;
}

napi_value StringValue(napi_env env, const std::wstring& value) {
  napi_value result;
  napi_create_string_utf16(
      env, reinterpret_cast<const char16_t*>(value.c_str()),
      value.size(), &result);
  return result;
}
}

napi_value CaptureExternalWindow(napi_env env, napi_callback_info info) {
  napi_value options = SingleObjectArg(env, info);
  const HWND child = ReadHwnd(env, GetNamed(env, options, "childHwnd"));
  const DWORD pid = static_cast<DWORD>(ReadInt32(env, options, "childPid"));
  std::string validation_error;
  if (!ValidateTarget(child, pid, &validation_error)) {
    napi_throw_error(env, nullptr, validation_error.c_str());
    return nullptr;
  }
  const HWND capture_window = ResolveCaptureWindow(child, pid);
  CapturedFrame frame;
  try {
    try {
      frame = CaptureWithGraphicsCapture(capture_window);
    } catch (...) {
      frame = CaptureWithPrintWindow(capture_window);
    }
  } catch (const std::exception& error) {
    napi_throw_error(env, nullptr, error.what());
    return nullptr;
  } catch (...) {
    napi_throw_error(env, nullptr, "Windows window capture failed");
    return nullptr;
  }
  napi_value output;
  napi_create_object(env, &output);
  SetNamed(env, output, "success", BoolValue(env, true));
  SetNamed(env, output, "method", StringValue(env, frame.method));
  SetNamed(env, output, "windowHwnd", HwndValue(env, capture_window));
  SetNamed(env, output, "boundWindowHwnd", HwndValue(env, child));
  SetNamed(env, output, "popup", BoolValue(env, capture_window != child));
  SetNamed(env, output, "width", IntValue(env, frame.width));
  SetNamed(env, output, "height", IntValue(env, frame.height));
  SetNamed(env, output, "originX", IntValue(env, frame.bounds.left));
  SetNamed(env, output, "originY", IntValue(env, frame.bounds.top));
  napi_value pixels;
  napi_create_buffer_copy(
      env, frame.rgba.size(), frame.rgba.data(), nullptr, &pixels);
  SetNamed(env, output, "pixels", pixels);
  return output;
}

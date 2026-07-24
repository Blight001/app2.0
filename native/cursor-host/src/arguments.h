#pragma once

#include <windows.h>

#include <string>

namespace cursor_host {

struct Arguments {
  bool watchdog = false;
  DWORD parent_pid = 0;
  HWND owner_hwnd = nullptr;
  HWND target_hwnd = nullptr;
  std::wstring pipe_name;
  std::wstring token;
  std::wstring session_id;
  std::wstring hidden_event;
  std::wstring clean_event;
  std::wstring cursor_asset_path;
};

bool ParseArguments(int argc, wchar_t** argv, Arguments* output,
                    std::wstring* error);

}  // namespace cursor_host

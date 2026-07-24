#pragma once

#include <string>

namespace cursor_host {

struct Arguments {
  std::wstring pipe_name;
  std::wstring token;
  std::wstring session_id;
  std::wstring cursor_asset_path;
};

bool ParseArguments(int argc, wchar_t** argv, Arguments* output,
                    std::wstring* error);

}  // namespace cursor_host

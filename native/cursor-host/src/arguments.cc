#include "arguments.h"

#include <string_view>

namespace cursor_host {
namespace {

bool IsHexToken(std::wstring_view token) {
  if (token.size() != 64) return false;
  for (const wchar_t character : token) {
    const bool digit = character >= L'0' && character <= L'9';
    const bool lower = character >= L'a' && character <= L'f';
    const bool upper = character >= L'A' && character <= L'F';
    if (!digit && !lower && !upper) return false;
  }
  return true;
}

bool IsSafeName(std::wstring_view value) {
  if (value.empty() || value.size() > 128) return false;
  for (const wchar_t character : value) {
    const bool alpha_numeric =
        (character >= L'a' && character <= L'z') ||
        (character >= L'A' && character <= L'Z') ||
        (character >= L'0' && character <= L'9');
    if (!alpha_numeric && character != L'-' && character != L'_') return false;
  }
  return true;
}

bool ReadValue(int argc, wchar_t** argv, int* index, std::wstring* output) {
  if (*index + 1 >= argc) return false;
  *output = argv[++(*index)];
  return !output->empty();
}

}  // namespace

bool ParseArguments(int argc, wchar_t** argv, Arguments* output,
                    std::wstring* error) {
  Arguments parsed;
  for (int index = 1; index < argc; ++index) {
    const std::wstring_view key(argv[index]);
    std::wstring value;
    if (!ReadValue(argc, argv, &index, &value)) {
      *error = L"命令行参数缺少值";
      return false;
    }
    if (key == L"--pipe") {
      parsed.pipe_name = L"\\\\.\\pipe\\" + value;
    } else if (key == L"--token") {
      parsed.token = value;
    } else if (key == L"--session") {
      parsed.session_id = value;
    } else if (key == L"--cursor-asset") {
      parsed.cursor_asset_path = value;
    } else {
      *error = L"存在未知命令行参数";
      return false;
    }
  }
  if (!IsSafeName(parsed.session_id) || !IsHexToken(parsed.token) ||
      parsed.pipe_name.size() <= 9 || parsed.pipe_name.size() > 160) {
    *error = L"Cursor Host 启动参数不完整或不安全";
    return false;
  }
  *output = std::move(parsed);
  return true;
}

}  // namespace cursor_host

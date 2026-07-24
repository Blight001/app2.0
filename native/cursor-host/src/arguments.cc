#include "arguments.h"

#include <cstdint>
#include <string_view>

namespace cursor_host {
namespace {

bool ParseUnsigned(std::wstring_view text, std::uint64_t* output) {
  if (text.empty()) return false;
  std::uint64_t value = 0;
  for (const wchar_t character : text) {
    if (character < L'0' || character > L'9') return false;
    const std::uint64_t digit = character - L'0';
    if (value > (UINT64_MAX - digit) / 10) return false;
    value = value * 10 + digit;
  }
  *output = value;
  return true;
}

bool IsHexToken(std::wstring_view token) {
  if (token.size() != 64) return false;
  for (wchar_t character : token) {
    const bool digit = character >= L'0' && character <= L'9';
    const bool lower = character >= L'a' && character <= L'f';
    const bool upper = character >= L'A' && character <= L'F';
    if (!digit && !lower && !upper) return false;
  }
  return true;
}

bool IsSafeName(std::wstring_view value) {
  if (value.empty() || value.size() > 128) return false;
  for (wchar_t character : value) {
    const bool alpha_numeric =
        (character >= L'a' && character <= L'z') ||
        (character >= L'A' && character <= L'Z') ||
        (character >= L'0' && character <= L'9');
    if (!alpha_numeric && character != L'-' && character != L'_') return false;
  }
  return true;
}

bool IsSafeEventName(std::wstring_view value) {
  constexpr std::wstring_view prefix = L"Local\\AI_FREE_CURSOR_";
  if (!value.starts_with(prefix)) return false;
  return IsSafeName(value.substr(prefix.size()));
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
    if (key == L"--watchdog") {
      parsed.watchdog = true;
    } else if (!ReadValue(argc, argv, &index, &value)) {
      *error = L"命令行参数缺少值";
      return false;
    } else if (key == L"--pipe") {
      parsed.pipe_name = L"\\\\.\\pipe\\" + value;
    } else if (key == L"--token") {
      parsed.token = value;
    } else if (key == L"--session") {
      parsed.session_id = value;
    } else if (key == L"--hidden-event") {
      parsed.hidden_event = value;
    } else if (key == L"--clean-event") {
      parsed.clean_event = value;
    } else {
      std::uint64_t number = 0;
      if (!ParseUnsigned(value, &number)) {
        *error = L"命令行数字参数无效";
        return false;
      }
      if (key == L"--owner-hwnd") {
        parsed.owner_hwnd = reinterpret_cast<HWND>(
            static_cast<std::uintptr_t>(number));
      } else if (key == L"--target-hwnd") {
        parsed.target_hwnd = reinterpret_cast<HWND>(
            static_cast<std::uintptr_t>(number));
      } else if (key == L"--parent-pid") {
        parsed.parent_pid = static_cast<DWORD>(number);
      } else {
        *error = L"存在未知命令行参数";
        return false;
      }
    }
  }
  const bool shared_valid = IsSafeName(parsed.session_id);
  const bool watchdog_valid = parsed.watchdog && parsed.parent_pid != 0 &&
      IsSafeEventName(parsed.hidden_event) &&
      IsSafeEventName(parsed.clean_event);
  const bool host_valid = !parsed.watchdog && parsed.owner_hwnd &&
      parsed.target_hwnd && IsHexToken(parsed.token) &&
      parsed.pipe_name.size() > 9 && parsed.pipe_name.size() <= 160;
  if (!shared_valid || (!watchdog_valid && !host_valid)) {
    *error = L"Cursor Host 启动参数不完整或不安全";
    return false;
  }
  *output = std::move(parsed);
  return true;
}

}  // namespace cursor_host

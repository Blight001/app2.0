#include "recovery_watchdog.h"

#include <shellapi.h>

#include <vector>

namespace cursor_host {
namespace {

std::wstring Quote(std::wstring_view value) {
  return L"\"" + std::wstring(value) + L"\"";
}

}  // namespace

bool StartRecoveryWatchdog(DWORD parent_pid, std::wstring_view session_id,
                           std::wstring_view hidden_event,
                           std::wstring_view clean_event) {
  std::vector<wchar_t> executable(MAX_PATH);
  DWORD length = GetModuleFileNameW(
      nullptr, executable.data(), static_cast<DWORD>(executable.size()));
  if (length == 0 || length >= executable.size()) return false;
  std::wstring command = Quote(executable.data()) +
      L" --watchdog --parent-pid " + std::to_wstring(parent_pid) +
      L" --session " + Quote(session_id) +
      L" --hidden-event " + Quote(hidden_event) +
      L" --clean-event " + Quote(clean_event);
  std::vector<wchar_t> mutable_command(command.begin(), command.end());
  mutable_command.push_back(L'\0');
  STARTUPINFOW startup{sizeof(startup)};
  PROCESS_INFORMATION process{};
  const bool created = CreateProcessW(
      executable.data(), mutable_command.data(), nullptr, nullptr, FALSE,
      CREATE_NO_WINDOW | DETACHED_PROCESS, nullptr, nullptr, &startup,
      &process) != FALSE;
  if (!created) return false;
  CloseHandle(process.hThread);
  CloseHandle(process.hProcess);
  return true;
}

int RunRecoveryWatchdog(DWORD parent_pid, std::wstring_view hidden_event,
                        std::wstring_view clean_event) {
  HANDLE parent = OpenProcess(SYNCHRONIZE, FALSE, parent_pid);
  HANDLE hidden = OpenEventW(SYNCHRONIZE, FALSE,
                             std::wstring(hidden_event).c_str());
  HANDLE clean = OpenEventW(SYNCHRONIZE, FALSE,
                            std::wstring(clean_event).c_str());
  if (!parent || !hidden || !clean) {
    if (parent) CloseHandle(parent);
    if (hidden) CloseHandle(hidden);
    if (clean) CloseHandle(clean);
    return 2;
  }
  HANDLE waits[] = {parent, clean};
  const DWORD result = WaitForMultipleObjects(2, waits, FALSE, INFINITE);
  if (result == WAIT_OBJECT_0 &&
      WaitForSingleObject(hidden, 0) == WAIT_OBJECT_0) {
    int count = 0;
    do {
      count = ShowCursor(TRUE);
    } while (count < 0);
  }
  CloseHandle(clean);
  CloseHandle(hidden);
  CloseHandle(parent);
  return result == WAIT_FAILED ? 3 : 0;
}

}  // namespace cursor_host

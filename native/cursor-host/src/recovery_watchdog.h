#pragma once

#include <windows.h>

#include <string>
#include <string_view>

namespace cursor_host {

bool StartRecoveryWatchdog(DWORD parent_pid, std::wstring_view session_id,
                           std::wstring_view hidden_event,
                           std::wstring_view clean_event);
int RunRecoveryWatchdog(DWORD parent_pid, std::wstring_view hidden_event,
                        std::wstring_view clean_event);

}  // namespace cursor_host

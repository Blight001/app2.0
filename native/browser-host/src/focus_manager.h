#pragma once

#include <windows.h>
#include <node_api.h>

// Transfers keyboard focus to an embedded Chromium browser while the owning
// Electron window is already in the foreground. This is also used by the
// low-level mouse hook so the click that selected an omnibox or page input is
// delivered after Chromium's Aura FocusManager has regained native focus.
bool FocusBrowserChildWindow(HWND child);

napi_value FocusChildWindow(napi_env env, napi_callback_info info);

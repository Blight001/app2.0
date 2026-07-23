#pragma once

#include <node_api.h>

napi_value DockExternalWindow(napi_env env, napi_callback_info info);
napi_value HideDockedExternalWindow(napi_env env, napi_callback_info info);
napi_value RestoreExternalWindow(napi_env env, napi_callback_info info);
napi_value IsExternalWindowDocked(napi_env env, napi_callback_info info);
napi_value GetWindowPlacementSnapshot(napi_env env, napi_callback_info info);

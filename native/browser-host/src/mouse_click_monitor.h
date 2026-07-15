#pragma once

#include <node_api.h>

napi_value WatchChildWindowClicks(napi_env env, napi_callback_info info);
napi_value UnwatchChildWindowClicks(napi_env env, napi_callback_info info);

#pragma once

#include <node_api.h>

napi_value ObserveExternalWindowUi(napi_env env, napi_callback_info info);
napi_value PerformExternalWindowUiAction(napi_env env, napi_callback_info info);

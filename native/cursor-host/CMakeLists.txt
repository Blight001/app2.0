cmake_minimum_required(VERSION 3.24)
project(ai_free_cursor_host LANGUAGES CXX)

add_executable(ai-free-cursor-host WIN32
  src/arguments.cc
  src/cursor_state_store.cc
  src/cursor_asset_cache.cc
  src/dcomp_renderer.cc
  src/frame_metrics.cc
  src/input_sampler.cc
  src/main.cc
  src/pipe_security.cc
  src/pipe_server.cc
  src/protocol.cc
  src/recovery_watchdog.cc
  src/system_cursor_lease.cc
  src/target_window_resolver.cc
)
target_compile_features(ai-free-cursor-host PRIVATE cxx_std_20)
target_compile_definitions(ai-free-cursor-host PRIVATE
  UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX
)
target_compile_options(ai-free-cursor-host PRIVATE /MT /utf-8)
target_link_libraries(ai-free-cursor-host PRIVATE
  advapi32 d2d1 d3d11 dcomp dwmapi dxgi ole32 shell32 user32 windowscodecs
)

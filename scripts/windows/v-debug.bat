@echo off
setlocal EnableExtensions
chcp 65001 >nul
title AI-FREE TCP Debug Launcher

pushd "%~dp0..\.." >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Failed to enter repo root.
  pause
  exit /b 1
)

rem Local debug target. Adjust to your own local service.
set "SERVER_BASE=http://127.0.0.1:59000"
set "LOCAL_SERVER_RESOLVER_URL=http://127.0.0.1:59000/api/server_vue/card-status/search"
set "SERVER_VUE_CARD_STATUS_SEARCH_URL=http://127.0.0.1:59000/api/server_vue/card-status/search"
set "PLATFORM=local"
set "DEBUG=1"
set "FORCE_HTTP_COMPAT_MODE="
set "NETWORK_COMPAT_MODE="
set "DISABLE_TCP_CONNECTION="
set "NO_TCP="
set "SKIP_LICENSE_WINDOW="
set "FORCE_COLOR=1"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] node not found. Please install Node.js first.
  popd >nul
  pause
  exit /b 1
)

call node scripts\set-side-url.js --mode=local
if errorlevel 1 (
  echo [ERROR] Failed to set local sideUrl.
  popd >nul
  pause
  exit /b 1
)

echo ========================================
echo   AI-FREE TCP Debug Launcher
echo ========================================
echo Server base: %SERVER_BASE%
echo Mode: TCP 连接（允许自动 HTTP 降级）
echo.

call node scripts\run-electron.js .
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  echo [OK] Launch complete.
) else (
  echo [ERROR] Launch failed, error code: %EXIT_CODE%
)
popd >nul
exit /b %EXIT_CODE%

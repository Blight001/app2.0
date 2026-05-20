@echo off
setlocal EnableExtensions

chcp 65001 >nul
title AI-FREE Network Compat Debug Launcher

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%..\.."
pushd "%REPO_ROOT%" >nul 2>&1
if errorlevel 1 (
  call :printErr Failed to enter repo root: %REPO_ROOT%
  pause
  exit /b 1
)

rem Local debug target. Adjust this to your own local service.
set "SERVER_BASE=http://127.0.0.1:59000"
set "LOCAL_SERVER_RESOLVER_URL=http://127.0.0.1:59000/api/server_vue/card-status/search"
set "SERVER_VUE_CARD_STATUS_SEARCH_URL=http://127.0.0.1:59000/api/server_vue/card-status/search"
set "PLATFORM=local"
set "DEBUG=1"
set "FORCE_HTTP_COMPAT_MODE=1"
set "SKIP_LICENSE_WINDOW="
set "FORCE_COLOR=1"

call node scripts\set-side-url.js --mode=local
if errorlevel 1 (
  call :printErr Failed to set local sideUrl.
  popd >nul
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  call :printErr node was not found. Please install Node.js first.
  popd >nul
  pause
  exit /b 1
)

call :printTitle ==========================================
call :printTitle   AI-FREE Network Compat Debug Launcher
call :printTitle ==========================================
echo.
call :printInfo Current dir: %CD%
call :printInfo Server base: %SERVER_BASE%
call :printInfo Platform: %PLATFORM%
call :printInfo Mode: HTTP兼容模式（不使用TCP连接）
call :printInfo First window: license page
call :printInfo Side URL: http://127.0.0.1:8787/control-panel/
call :printInfo Command: node scripts\run-electron.js .
echo.

color 07
call node scripts\run-electron.js .
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  call :printOk Launch complete
) else (
  call :printErr Launch failed, error code: %EXIT_CODE%
)
echo.
popd >nul
color 07
exit /b %EXIT_CODE%

:printTitle
color 0B
echo %~1
color 07
exit /b 0

:printInfo
color 09
echo %~1
color 07
exit /b 0

:printOk
color 0A
echo %~1
color 07
exit /b 0

:printErr
color 0C
echo %~1
color 07
exit /b 0

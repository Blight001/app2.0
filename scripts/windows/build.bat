@echo off
setlocal EnableExtensions

pushd "%~dp0..\.." >nul 2>&1
if errorlevel 1 (
  echo Failed to enter repo root.
  pause
  exit /b 1
)

node scripts\windows\build-win.js
set "EXIT_CODE=%ERRORLEVEL%"

echo.
pause
popd >nul
exit /b %EXIT_CODE%

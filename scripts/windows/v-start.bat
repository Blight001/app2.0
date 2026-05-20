@echo off
setlocal EnableExtensions

chcp 65001 >nul
title AI-FREE Launcher

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%..\.."
pushd "%REPO_ROOT%" >nul 2>&1
if errorlevel 1 (
  call :printErr Failed to enter repo root: %REPO_ROOT%
  pause
  exit /b 1
)

set "PLATFORM="
if /I "%~1"=="--platform" if not "%~2"=="" set "PLATFORM=%~2"
set "FORCE_COLOR=1"

where npm >nul 2>&1
if errorlevel 1 (
  call :printErr npm was not found. Please install Node.js first.
  popd >nul
  pause
  exit /b 1
)

call :printTitle ==========================================
call :printTitle   AI-FREE Launcher
call :printTitle ==========================================
echo.
call :printInfo Current dir: %CD%
if defined PLATFORM call :printInfo Platform: %PLATFORM%
call :printInfo Command: npm start
echo.

color 07
call npm start
set "EXIT_CODE=%ERRORLEVEL%"

echo.
if "%EXIT_CODE%"=="0" (
  call :printOk Launch complete
) else (
  call :printErr Launch failed, error code: %EXIT_CODE%
)
echo.
popd >nul
pause

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

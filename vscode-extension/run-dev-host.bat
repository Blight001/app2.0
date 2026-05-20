@echo off
setlocal

cd /d "%~dp0"

where code >nul 2>nul
if errorlevel 1 (
  echo [ERROR] VS Code command "code" not found. Open VS Code and run "Shell Command: Install 'code' command in PATH", then retry.
  exit /b 1
)

echo Starting VS Code Extension Development Host...
code --extensionDevelopmentPath="%cd%"

endlocal

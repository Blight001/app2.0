@echo off
setlocal

cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm not found. Please install Node.js first.
  exit /b 1
)

echo [1/4] Installing dependencies...
call npm install
if errorlevel 1 exit /b 1

echo [2/4] Running checks...
call npm run check
if errorlevel 1 exit /b 1

echo [3/4] Packaging VSIX...
call npx --yes @vscode/vsce package --allow-missing-repository
if errorlevel 1 exit /b 1

echo [4/4] Done.
echo.
echo VSIX package created in:
echo %cd%
echo.
echo Install it with:
echo code --install-extension ai-free-tools-vscode-0.1.0.vsix

endlocal

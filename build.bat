@echo off
setlocal EnableExtensions
chcp 65001 >nul
title AI-FREE Build

pushd "%~dp0" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Failed to enter repo root.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm not found. Please install Node.js first.
  popd >nul
  pause
  exit /b 1
)

echo ========================================
echo   AI-FREE 安装程序打包 ^(NSIS^)
echo ========================================
echo [保护] 将在打包副本中混淆 extensions 插件 JavaScript
echo.

node -e "require.resolve('javascript-obfuscator')" >nul 2>&1
if errorlevel 1 (
  echo [ERROR] 缺少打包保护依赖 javascript-obfuscator。
  echo         请先运行: npm install
  popd >nul
  pause
  exit /b 1
)

rem === 让 electron/electron-builder 的下载走本地 7897 代理 ===
rem @electron/get 默认不读系统代理，需显式开启 global-agent
set "ELECTRON_GET_USE_PROXY=true"
set "GLOBAL_AGENT_HTTP_PROXY=http://127.0.0.1:7897"
set "GLOBAL_AGENT_HTTPS_PROXY=http://127.0.0.1:7897"
rem electron-builder 自身下载(nsis/winCodeSign 等)读这两个
set "HTTP_PROXY=http://127.0.0.1:7897"
set "HTTPS_PROXY=http://127.0.0.1:7897"

@call npm run build:win
@set "EXIT_CODE=%ERRORLEVEL%"
@echo off

echo.
if "%EXIT_CODE%"=="0" (
  echo [OK] 打包完成，安装程序已输出到 appbuild 目录。
) else (
  echo [ERROR] 打包失败，错误码: %EXIT_CODE%
)
popd >nul
pause
exit /b %EXIT_CODE%

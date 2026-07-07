@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title AI-FREE Backup

pushd "%~dp0..\.." >nul 2>&1
if errorlevel 1 (
  echo [ERROR] 无法进入项目根目录。
  pause
  exit /b 1
)

rem 用日期时间作为备份文件夹名
for /f "tokens=2 delims==" %%i in ('wmic os get localdatetime /value') do set "datetime=%%i"
set "timestamp=%datetime:~0,8%_%datetime:~8,6%"
set "backup_dir=version\backup_%timestamp%"
mkdir "%backup_dir%" >nul 2>&1
echo 备份目录: %backup_dir%
echo.

rem 要备份的文件和目录
set "items=src config docs README.md README_zh-CN.md package.json package-lock.json scripts\windows\build.bat scripts\windows\backup.bat scripts\windows\v-start.bat scripts\windows\v-debug.bat scripts\windows\v-debug-http.bat"

for %%i in (%items%) do (
  if exist "%%i\" (
    xcopy "%%i" "%backup_dir%\%%i\" /E /I /H /Y >nul 2>&1 && echo [OK] 目录 %%i || echo [ERROR] 目录 %%i
  ) else if exist "%%i" (
    copy "%%i" "%backup_dir%\" >nul 2>&1 && echo [OK] 文件 %%i || echo [ERROR] 文件 %%i
  ) else (
    echo [SKIP] %%i 不存在
  )
)

echo.
echo 备份完成，位置: %backup_dir%
popd >nul
pause

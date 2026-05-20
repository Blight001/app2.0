@echo off
setlocal EnableDelayedExpansion

chcp 65001 >nul

set "SCRIPT_DIR=%~dp0"
set "REPO_ROOT=%SCRIPT_DIR%..\.."
pushd "%REPO_ROOT%" >nul 2>&1
if errorlevel 1 (
    echo 无法进入项目根目录: %REPO_ROOT%
    pause
    exit /b 1
)

:: 获取当前日期和时间作为备份文件夹名称
for /f "tokens=2 delims==" %%i in ('wmic os get localdatetime /value') do set datetime=%%i
set "timestamp=%datetime:~0,8%_%datetime:~8,6%"

:: 检查并创建version目录
set "version_dir=version"
if not exist "%version_dir%" (
    mkdir "%version_dir%"
    echo 创建版本目录: %version_dir%
)

:: 创建备份目录在version文件夹内
set "backup_dir=%version_dir%\backup_%timestamp%"
if not exist "%backup_dir%" (
    mkdir "%backup_dir%"
    echo 创建备份目录: %backup_dir%
) else (
    echo 备份目录已存在: %backup_dir%
)

:: 要备份的文件和目录列表
set "items_to_backup=core src config docs README.md README_zh-CN.md package.json package-lock.json scripts\\windows\\build.bat scripts\\windows\\backup.bat scripts\\windows\\v-start.bat scripts\\windows\\v-debug.bat scripts\\windows\\v-debug-tcp.bat"

echo 开始备份文件和目录...
echo.

:: 备份每个项目
for %%i in (%items_to_backup%) do (
    if exist "%%i" (
        if exist "%%i\" (
            :: 如果是目录，使用xcopy
            echo 备份目录: %%i
            xcopy "%%i" "%backup_dir%\%%i\" /E /I /H /Y >nul 2>&1
            if !errorlevel! equ 0 (
                echo [OK] 目录 %%i 已备份
            ) else (
                echo [ERROR] 备份目录 %%i 失败
            )
        ) else (
            :: 如果是文件，使用copy
            echo 备份文件: %%i
            copy "%%i" "%backup_dir%\" >nul 2>&1
            if !errorlevel! equ 0 (
                echo [OK] 文件 %%i 已备份
            ) else (
                echo [ERROR] 备份文件 %%i 失败
            )
        )
    ) else (
        echo [WARNING] 项目 %%i 不存在，跳过备份
    )
)

echo.
echo 备份完成！
echo 备份位置: "%backup_dir%"
echo.

:: 显示备份内容
echo 备份内容列表:
if exist "%backup_dir%" (
    dir "%backup_dir%" /b
)

echo.
pause
popd >nul

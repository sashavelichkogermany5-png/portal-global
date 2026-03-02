@echo off
setlocal EnableExtensions

set "REPO=C:\Users\user\portal-global"
set "LOGDIR=%REPO%\ops\tmp"
set "LOG=%LOGDIR%\lv-pack-upload.log"
set "LOCK=%LOGDIR%\lv-pack.lock"
set "PS1=%REPO%\ops\lv-pack-upload-logged.ps1"

if not exist "%LOGDIR%" mkdir "%LOGDIR%"

REM Prefer PS logging wrapper (more reliable in OpenCode)
if exist "%PS1%" (
  pwsh -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
  exit /b %errorlevel%
)

REM Ensure SYSTEM can find rclone that we copied into repo
set "PATH=%REPO%\ops\bin;%PATH%"

REM Make rclone use user's config even under SYSTEM
set "RCLONE_CONFIG=C:\Users\user\AppData\Roaming\rclone\rclone.conf"
set "RCLONE_EXE=%REPO%\ops\bin\rclone.exe"

REM If another run is still active, skip safely (DO NOT delete lock here)
if exist "%LOCK%" (
  echo === %date% %time% SKIP (lock exists) ===>> "%LOG%"
  exit /b 0
)

echo lock>%LOCK%

set "rc=0"
set "rc2=0"

echo === %date% %time% START ===>> "%LOG%"
cd /d "%REPO%" >> "%LOG%" 2>&1

pwsh -NoProfile -ExecutionPolicy Bypass -File "ops\lv-pack.ps1" >> "%LOG%" 2>&1
set "rc=%errorlevel%"

"%RCLONE_EXE%" copyto "docs\LV-PACK.generated.txt" "gdrive:PORTAL-LV/sources/LV-PACK.generated.txt" --transfers 1 --tpslimit 2 --tpslimit-burst 2 --retries 10 --low-level-retries 20 >> "%LOG%" 2>&1
set "rc2=%errorlevel%"

:CLEANUP
echo === %date% %time% END rc=%rc% rc2=%rc2% ===>> "%LOG%"
del /q "%LOCK%" >nul 2>&1
exit /b %rc2%

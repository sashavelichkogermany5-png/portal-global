@echo off
setlocal

cd /d C:\Users\user\portal-global

REM 1) generate pack (+ txt autogen inside lv-pack.ps1)
pwsh.exe -NoProfile -ExecutionPolicy Bypass -File ops\lv-pack.ps1
if errorlevel 1 exit /b %errorlevel%

REM 2) upload TXT for NotebookLM
rclone copyto docs\LV-PACK.generated.txt gdrive:PORTAL-LV/sources/LV-PACK.generated.txt --transfers 1 --tpslimit 2 --tpslimit-burst 2 --retries 10 --low-level-retries 20

endlocal

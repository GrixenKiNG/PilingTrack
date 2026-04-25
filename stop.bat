@echo off
rem Stop PilingTrack-related processes started by start.bat / start-prod.bat.
rem Targets the Next.js port (3000) and the unified worker health port (3002 —
rem see WORKER_HEALTH_PORT in src/workers).

setlocal
cd /d "%~dp0"

echo.
echo Stopping PilingTrack...

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-piling.ps1"

endlocal

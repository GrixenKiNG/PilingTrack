@echo off
rem Stop PilingTrack - both the Docker stack and any local npm processes.

setlocal
cd /d "%~dp0"

echo.
echo Stopping PilingTrack...
echo.

rem 1. Stop Docker stack if compose file is present.
if exist docker-compose.yml (
  if exist .env.docker (
    echo Stopping Docker stack...
    docker compose --env-file .env.docker down
  ) else (
    echo Stopping Docker stack (no .env.docker, using defaults)...
    docker compose down 2>nul
  )
)

rem 2. Kill any local npm/node processes started by start.bat dev/prod.
if exist scripts\stop-piling.ps1 (
  echo Stopping local npm/node processes...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop-piling.ps1"
)

echo.
echo Done.
endlocal

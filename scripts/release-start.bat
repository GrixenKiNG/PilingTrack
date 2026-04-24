@echo off
rem PilingTrack standalone launcher.
rem Placed next to server.js inside the unpacked release folder by
rem scripts\copy-standalone-assets.js during `npm run build`.

setlocal
cd /d "%~dp0"

if not exist .env (
  echo.
  echo ERROR: .env file not found in %CD%
  echo Create .env with at least DATABASE_URL_POSTGRES, REDIS_URL, SESSION_SECRET.
  echo See scripts\validate-env.ts in the source tree for the full list.
  echo.
  pause
  exit /b 1
)

if not exist server.js (
  echo.
  echo ERROR: server.js not found in %CD%
  echo Run start.bat from inside the unpacked release folder.
  echo.
  pause
  exit /b 1
)

if not defined NODE_ENV set NODE_ENV=production
if not defined PORT set PORT=3000
if not defined HOSTNAME set HOSTNAME=0.0.0.0

echo Starting PilingTrack on http://%HOSTNAME%:%PORT% ...
node server.js

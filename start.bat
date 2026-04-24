@echo off
rem PilingTrack local launcher (dev by default, accepts `prod`/`dev` arg).
rem For running the released zip on a server, use the start.bat shipped
rem INSIDE the release archive, not this file.

setlocal enabledelayedexpansion
cd /d "%~dp0"

if not defined EMBEDDED_WORKERS set EMBEDDED_WORKERS=default

set MODE=dev
if /I "%~1"=="prod" set MODE=prod
if /I "%~1"=="production" set MODE=prod
if /I "%~1"=="dev" set MODE=dev
if /I "%~1"=="development" set MODE=dev

echo.
echo ============================================================
echo  PilingTrack v2.0.0  —  %MODE% mode
echo  URL: http://localhost:3000
echo ============================================================

rem Fail fast if the local stack is not up — the app needs Postgres (5432)
rem and Redis (6379) listening. Avoids cryptic 500s during startup.
call :check_port 5432 Postgres || goto missing_deps
call :check_port 6379 Redis    || goto missing_deps

echo Dependencies: Postgres OK, Redis OK
echo.

if "%MODE%"=="prod" goto prod

echo Starting in development mode (hot reload)...
echo.
call npm.cmd run dev
goto end

:prod
echo Building and starting in production mode...
echo.
call npm.cmd run build
if errorlevel 1 goto build_failed
call npm.cmd run start
goto end

:check_port
netstat -ano | findstr /C:":%~1 " | findstr /C:"LISTENING" >nul
if errorlevel 1 (
  echo ERROR: %~2 is not listening on port %~1.
  exit /b 1
)
exit /b 0

:missing_deps
echo.
echo Start Postgres and Redis, then re-run this script.
echo.
pause
exit /b 1

:build_failed
echo.
echo Build failed. Production server was not started.
exit /b 1

:end
endlocal

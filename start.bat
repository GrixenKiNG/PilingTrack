@echo off
rem PilingTrack launcher.
rem
rem Default (no args / "dev"):  local `npm run dev` against Docker DB-only stack.
rem                             This is the recommended workflow for development.
rem With "docker":              full Docker stack (app + workers + ws + DB).
rem With "prod":                local `npm run build` + `npm run start` against Docker DB.
rem
rem For first-time setup on a fresh machine, run setup.bat instead.

setlocal enabledelayedexpansion
cd /d "%~dp0"

set MODE=dev
if /I "%~1"=="dev"         set MODE=dev
if /I "%~1"==""            set MODE=dev
if /I "%~1"=="development" set MODE=dev
if /I "%~1"=="prod"        set MODE=prod
if /I "%~1"=="production"  set MODE=prod
if /I "%~1"=="docker"      set MODE=docker

echo.
echo ============================================================
echo  PilingTrack v2.1.0  -  %MODE% mode
echo  URL: http://localhost:3000
echo ============================================================

if not exist .env.docker (
  echo ERROR: .env.docker not found. Run setup.bat first.
  pause
  exit /b 1
)

if "%MODE%"=="docker" goto docker_mode

rem ------------------------------------------------------------
rem dev / prod modes:
rem   - Bring up DB-only services (postgres, redis, pgbouncer, minio).
rem   - Stop any Docker app/workers/ws containers (so port 3000/3001
rem     is free and outbox/projection workers don't race the local ones).
rem ------------------------------------------------------------
if not exist .env (
  echo ERROR: .env not found. Run setup.bat to generate it.
  pause
  exit /b 1
)

echo Stopping Docker app/workers/ws (so local npm owns ports 3000/3001)...
docker compose --env-file .env.docker stop app workers ws >nul 2>&1

echo Starting Docker DB services (postgres, redis, pgbouncer, minio)...
docker compose --env-file .env.docker up -d postgres redis pgbouncer minio minio-init
if errorlevel 1 goto fail

call :wait_port 5435 "Postgres"   || goto fail
call :wait_port 6379 "Redis"      || goto fail
echo Dependencies: Postgres OK, Redis OK
echo.

if "%MODE%"=="prod" goto prod

echo Starting npm dev server (hot reload)...
echo App connects to Postgres at localhost:5435, Redis at localhost:6379.
echo.
call npm.cmd run dev
goto end

:prod
echo Building and starting npm in production mode...
echo.
call npm.cmd run build
if errorlevel 1 goto build_failed
call npm.cmd run start
goto end

:docker_mode
echo Starting full Docker stack (postgres + redis + app + ws + workers + minio)...
echo.
docker compose --env-file .env.docker up -d
if errorlevel 1 goto fail
echo.
echo Stack started. Status:
docker compose --env-file .env.docker ps
echo.
echo  Open: http://localhost:3000
echo  Logs: docker compose --env-file .env.docker logs -f app
echo  Stop: stop.bat
goto end

rem ============================================================
rem Helper: poll a TCP port up to ~30 seconds for LISTEN.
rem ============================================================
:wait_port
set PORT=%~1
set NAME=%~2
set TRIES=0
:wait_port_loop
netstat -ano | findstr /C:":%PORT% " | findstr /C:"LISTENING" >nul
if not errorlevel 1 exit /b 0
set /a TRIES+=1
if !TRIES! GEQ 15 (
  echo ERROR: %NAME% on port %PORT% did not become ready.
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto wait_port_loop

:build_failed
echo.
echo Build failed. Production server was not started.
exit /b 1

:fail
echo.
echo Failed to start. See output above.
pause
exit /b 1

:end
endlocal

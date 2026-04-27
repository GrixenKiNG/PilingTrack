@echo off
rem PilingTrack launcher.
rem
rem Without args:        start the Docker stack (recommended).
rem With "dev":          start npm dev server against the running Docker
rem                      Postgres (5435) and Redis (6379).
rem With "prod":         build + start npm in production mode against Docker.
rem
rem For first-time setup on a fresh machine, run setup.bat instead.

setlocal enabledelayedexpansion
cd /d "%~dp0"

set MODE=docker
if /I "%~1"=="dev"         set MODE=dev
if /I "%~1"=="development" set MODE=dev
if /I "%~1"=="prod"        set MODE=prod
if /I "%~1"=="production"  set MODE=prod
if /I "%~1"=="docker"      set MODE=docker

echo.
echo ============================================================
echo  PilingTrack v2.1.0  -  %MODE% mode
echo  URL: http://localhost:3000
echo ============================================================

if "%MODE%"=="docker" goto docker_mode

rem ------ dev / prod modes need Docker Postgres + Redis listening ------
rem Local dev runs the app on port 3000 and starts embedded outbox/projection
rem workers inside Next.js. Stop the Docker app/workers containers so they do
rem not hold port 3000 and do not race for outbox leader-election.
echo Stopping Docker app + workers (so local dev owns port 3000)...
docker compose --env-file .env.docker stop app workers >nul 2>&1
echo.
call :check_port 5435 "Postgres (Docker, port 5435)" || goto missing_deps
call :check_port 6379 "Redis (Docker, port 6379)"    || goto missing_deps
echo Dependencies: Postgres OK, Redis OK
echo.

if "%MODE%"=="prod" goto prod

echo Starting npm dev server (hot reload)...
echo App will use the Docker Postgres at localhost:5435.
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
echo Starting Docker stack (Postgres + Redis + app + ws + workers)...
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

:check_port
netstat -ano | findstr /C:":%~1 " | findstr /C:"LISTENING" >nul
if errorlevel 1 (
  echo ERROR: %~2 is not listening.
  exit /b 1
)
exit /b 0

:missing_deps
echo.
echo Dev/prod mode needs the Docker stack running first.
echo Start it with:    start.bat
echo Or do a fresh setup:  setup.bat
echo.
pause
exit /b 1

:build_failed
echo.
echo Build failed. Production server was not started.
exit /b 1

:fail
echo.
echo Failed to start Docker stack. See output above.
pause
exit /b 1

:end
endlocal

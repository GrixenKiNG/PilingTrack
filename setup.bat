@echo off
rem One-command bootstrap for PilingTrack on a fresh machine.
rem Generates secrets if missing, brings the full stack up via Docker
rem (Postgres + Redis + app + workers + WebSocket), and waits for
rem migration + seed to finish before printing credentials.

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ============================================================
echo  PilingTrack — first-run setup
echo ============================================================

rem 1. Verify Docker is available.
docker --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Docker is not installed or not on PATH.
  echo Install Docker Desktop from https://docs.docker.com/desktop/install/windows-install/
  pause
  exit /b 1
)

docker compose version >nul 2>&1
if errorlevel 1 (
  echo ERROR: docker compose plugin is not installed.
  echo Update Docker Desktop to a recent version.
  pause
  exit /b 1
)

rem 2. Generate .env.docker if missing.
if not exist .env.docker (
  echo Generating .env.docker with random secrets...
  call :gen_env || goto fail
  echo   - .env.docker created.
) else (
  echo .env.docker already exists - skipping secret generation.
)

rem 3. Bring up the stack.
echo.
echo Building and starting containers (first run takes 3-5 min)...
docker compose --env-file .env.docker up -d --build
if errorlevel 1 goto fail

rem 4. Wait for the migrate container to finish.
echo.
echo Waiting for database migrations + seed to complete...
docker compose --env-file .env.docker logs -f migrate
docker compose --env-file .env.docker wait migrate >nul 2>&1

rem 5. Done.
echo.
echo ============================================================
echo  PilingTrack is up.
echo.
echo  App:        http://localhost:3000
echo  WebSocket:  ws://localhost:3001
echo  Postgres:   localhost:5432   (user: piling)
echo  PgBouncer:  localhost:6432
echo  Redis:      localhost:6379
echo.
echo  Default credentials (change after first login):
echo    admin:      admin@piling.ru     / admin123
echo    dispatcher: dispatch@piling.ru  / dispatch123
echo    operator:   operator@piling.ru  / operator123
echo    helper:     helper@piling.ru    / helper123
echo.
echo  Stop the stack:    docker compose --env-file .env.docker down
echo  Reset everything:  docker compose --env-file .env.docker down -v
echo ============================================================
endlocal
exit /b 0

rem ============================================================
rem Helper: write .env.docker with cryptographically random secrets.
rem ============================================================
:gen_env
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\generate-env-docker.ps1"
exit /b %errorlevel%

:fail
echo.
echo Setup failed. See the output above.
pause
exit /b 1

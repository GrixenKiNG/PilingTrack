@echo off
rem One-command bootstrap for PilingTrack on a fresh machine.
rem
rem Workflow: local `npm run dev` against Docker-only DB services.
rem Generates secrets, brings up DB services (postgres, redis, pgbouncer,
rem minio), runs migrations + seed, then prints credentials.
rem
rem To bring up the full Docker stack (app + workers + ws), run: start.bat docker

setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ============================================================
echo  PilingTrack - first-run setup (local dev mode)
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

rem 2. Verify Node + npm.
node --version >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or not on PATH.
  echo Install Node.js 22 LTS from https://nodejs.org/
  pause
  exit /b 1
)

rem 3. Generate .env.docker + .env if missing.
if not exist .env.docker (
  echo Generating .env.docker and .env with random secrets...
  call :gen_env || goto fail
) else (
  echo .env.docker already exists - skipping secret generation.
  if not exist .env (
    echo WARNING: .env is missing. Delete .env.docker and re-run setup.bat to regenerate both.
  )
)

rem 4. Install npm dependencies.
echo.
echo Installing npm dependencies...
call npm.cmd ci
if errorlevel 1 goto fail

rem 5. Bring up DB-only Docker services.
echo.
echo Starting Docker DB services (postgres, redis, pgbouncer, minio)...
docker compose --env-file .env.docker up -d postgres redis pgbouncer minio minio-init
if errorlevel 1 goto fail

rem 6. Wait for Postgres to accept connections.
echo.
echo Waiting for Postgres to become healthy...
set RETRIES=0
:wait_pg
docker exec pilingtrack-postgres pg_isready -U piling >nul 2>&1
if not errorlevel 1 goto pg_ready
set /a RETRIES+=1
if !RETRIES! GEQ 30 (
  echo ERROR: Postgres did not become ready within 60 seconds.
  goto fail
)
timeout /t 2 /nobreak >nul
goto wait_pg
:pg_ready
echo Postgres is ready.

rem 7. Run migrations + seed.
echo.
echo Applying Prisma migrations...
call npm.cmd run db:migrate:deploy
if errorlevel 1 goto fail

echo.
echo Seeding database...
call npm.cmd run db:seed
if errorlevel 1 (
  echo WARNING: Seed failed - DB may already contain data. Continuing.
)

rem 8. Done.
echo.
echo ============================================================
echo  PilingTrack is ready for local development.
echo.
echo  Next steps:
echo    start.bat            (default: local npm dev + Docker DB)
echo    start.bat docker     (full Docker stack including app)
echo    start.bat prod       (local production build)
echo    stop.bat             (stop everything)
echo.
echo  URLs:
echo    App:        http://localhost:3000
echo    WebSocket:  ws://localhost:3001 (Docker only by default)
echo    Postgres:   localhost:5435   (user: piling, db: pilingtrack)
echo    PgBouncer:  localhost:6432
echo    Redis:      localhost:6379
echo    MinIO UI:   http://localhost:9001  (user/pass: minioadmin)
echo.
echo  Default credentials (change after first login):
echo    admin:      admin@piling.ru     / admin123
echo    dispatcher: dispatch@piling.ru  / dispatch123
echo    operator:   operator@piling.ru  / operator123
echo    helper:     helper@piling.ru    / helper123
echo.
echo  Telegram alerts (optional):
echo    1. Create a bot via @BotFather, get the token.
echo    2. Add the bot to a group, send any message there.
echo    3. Open http://localhost:3000/admin/telegram and add a config.
echo    4. Submitted reports are auto-sent to the chat with PDF.
echo ============================================================
endlocal
exit /b 0

rem ============================================================
rem Helper: write .env.docker + .env with random secrets.
rem ============================================================
:gen_env
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\generate-env-docker.ps1"
exit /b %errorlevel%

:fail
echo.
echo Setup failed. See the output above.
pause
exit /b 1

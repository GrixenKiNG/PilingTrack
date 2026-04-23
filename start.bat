@echo off
setlocal

cd /d "%~dp0"

if not defined EMBEDDED_WORKERS set EMBEDDED_WORKERS=default

if /I "%~1"=="prod" goto prod
if /I "%~1"=="production" goto prod
if /I "%~1"=="dev" goto dev
if /I "%~1"=="development" goto dev

echo Starting PilingTrack in development mode...
echo URL: http://localhost:3000
echo.
call npm.cmd run dev
goto end

:dev
echo Starting PilingTrack in development mode...
echo URL: http://localhost:3000
echo.
call npm.cmd run dev
goto end

:prod
echo Building and starting PilingTrack in production mode...
echo URL: http://localhost:3000
echo.
call npm.cmd run build
if errorlevel 1 goto fail

call npm.cmd run start
goto end

:fail
echo.
echo Build failed. Production server was not started.
exit /b 1

:end
endlocal

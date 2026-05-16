@echo off
rem Shortcut: always build + run PilingTrack in production mode from source.
rem Delegates to start.bat so the dependency checks and banner stay in one place.
rem Port 3000 is freed automatically via the prestart npm hook
rem (scripts/kill-port.js) before `npm run start` boots.

cd /d "%~dp0"
call "%~dp0start.bat" prod %*

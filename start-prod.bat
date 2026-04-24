@echo off
rem Shortcut: always build + run PilingTrack in production mode from source.
rem Delegates to start.bat so the dependency checks and banner stay in one place.

cd /d "%~dp0"
call "%~dp0start.bat" prod %*

@echo off
cd /d "%~dp0"
node --version >nul 2>&1
if errorlevel 1 (
 echo Install Node.js 24 or newer, then run this file again.
 pause
 exit /b 1
)
node scripts/build-worker.mjs
if errorlevel 1 (pause & exit /b 1)
node local/server.mjs
pause

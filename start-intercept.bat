@echo off
REM ============================================================
REM  Intercept - start the app + public tunnel after a reboot.
REM  Just double-click this file (or the desktop "Intercept" icon).
REM  Two windows open:
REM    1) "Intercept server"  - the app
REM    2) this window         - the public tunnel + your link
REM  Your public link is also saved to:  current-url.txt
REM ============================================================
cd /d "%~dp0"

echo Starting Intercept server...
start "Intercept server" cmd /k node src/server.js

echo Waiting for the server to come up...
timeout /t 5 /nobreak >nul

echo Starting public tunnel (getting your link)...
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0show-url.ps1"

@echo off
title PIERRE STOCK WAR ROOM // LAUNCHER
color 0B
echo ======================================================================
echo             PIERRE STOCK WAR ROOM -- OPENCLAW GATEWAY
echo ======================================================================
echo.

cd /d "%~dp0"

echo [1/2] Checking dependencies...
if not exist "node_modules\" (
    echo Installing node dependencies...
    call npm install
)

echo [2/2] Launching Pierre Stock War Room on http://localhost:3888 ...
start "" http://localhost:3888

node server.js
pause

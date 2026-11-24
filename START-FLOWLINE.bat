@echo off
title Flowline - AWS CodePipeline Command Center
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :installnode

if exist node_modules goto :run
echo Installing dependencies. First run only, takes 1-2 minutes...
call npm install
if errorlevel 1 goto :npmfail

:run
echo.
echo Starting Flowline. Your browser opens at http://localhost:5173
echo Keep this window open while you use the app. Close it to stop the app.
echo.
start "" cmd /c "timeout /t 8 >nul & start http://localhost:5173"
call npm run dev
pause
exit /b 0

:installnode
echo Node.js is not installed on this laptop.
echo Installing Node.js LTS with winget. Approve the prompt if Windows asks...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
echo.
echo Done. Close this window, then double-click START-FLOWLINE.bat again.
echo If winget is missing, install Node.js LTS from https://nodejs.org and run this file again.
pause
exit /b 1

:npmfail
echo.
echo npm install failed. Check the internet connection and run this file again.
pause
exit /b 1

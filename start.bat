@echo off
title AI Chat App
cd /d "%~dp0"

echo.
echo ========================================
echo   AI Chat - Starting Up
echo ========================================
echo.

echo Building fresh frontend...
call npm run build
if errorlevel 1 (
  echo Build failed!
  pause
  exit /b 1
)

echo.
echo ========================================
echo   Server Started!
echo ========================================
echo   Local:    http://localhost:3000
echo   Network:  Check console for IP
echo ========================================
echo.

node server.js

pause

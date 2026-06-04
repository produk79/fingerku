@echo off
setlocal EnableExtensions
title CSL Fingerprint - Full JS App
cd /d "%~dp0"

set "APP_PORT=8080"
set "APP_URL=http://127.0.0.1:%APP_PORT%/"

echo.
echo ============================================================
echo  CSL Fingerprint - Full JavaScript
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terinstall atau belum masuk PATH.
  echo Install Node.js LTS, lalu jalankan file ini lagi.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo Dependency belum ada. Menjalankan npm install...
  call npm install
  if errorlevel 1 (
    echo.
    echo Gagal install dependency.
    pause
    exit /b 1
  )
)

echo Cek syntax server.js...
node --check server.js
if errorlevel 1 (
  echo.
  echo server.js masih error. Perbaiki dulu sebelum running.
  pause
  exit /b 1
)

echo.
echo Aplikasi JS akan jalan di:
echo   %APP_URL%
echo.
echo Tekan CTRL+C untuk berhenti.
echo.

start "" "%APP_URL%"
set "PORT=%APP_PORT%"
node server.js

pause

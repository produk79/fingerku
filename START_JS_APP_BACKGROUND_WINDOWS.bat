@echo off
setlocal EnableExtensions
title Start CSL Fingerprint JS
cd /d "%~dp0"

set "APP_PORT=8080"
set "APP_URL=http://127.0.0.1:%APP_PORT%/"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js belum terinstall atau belum masuk PATH.
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo Dependency belum ada. Jalankan RUN_JS_APP_WINDOWS.bat dulu.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$port=%APP_PORT%; $open = Test-NetConnection -ComputerName 127.0.0.1 -Port $port -InformationLevel Quiet; if($open){ exit 10 }"
if "%ERRORLEVEL%"=="10" (
  echo Server JS sudah berjalan di %APP_URL%
  start "" "%APP_URL%"
  exit /b 0
)

echo Menjalankan server JS background...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:PORT='%APP_PORT%'; Start-Process -FilePath 'node.exe' -ArgumentList 'server.js' -WorkingDirectory '%CD%' -WindowStyle Hidden"

timeout /t 2 >nul
start "" "%APP_URL%"
echo Server JS dibuka: %APP_URL%

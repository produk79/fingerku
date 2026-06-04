@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Cek IP Fingerprint - Ping Terminal

echo.
echo ============================================================
echo  Cek IP Fingerprint dari Windows
echo ============================================================
echo.
echo Script ini cek:
echo  1. Ping ke IP/host
echo  2. Port TCP mesin fingerprint, default 4370
echo.

set "HOST=%~1"
set "PORT=%~2"
set "PAUSE_AT_END=0"

if "%HOST%"=="" (
  set "PAUSE_AT_END=1"
  set /p "HOST=Masukkan IP/host Tailscale, publik, atau lokal: "
)

if "%PORT%"=="" (
  set /p "PORT=Masukkan port [4370]: "
)

if "%PORT%"=="" set "PORT=4370"

echo.
echo Target: %HOST%:%PORT%
echo.
echo [1/3] Ping %HOST%
echo ------------------------------------------------------------
ping -n 4 -w 1000 "%HOST%"

echo.
echo [2/3] Cek port TCP %PORT%
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "Test-NetConnection -ComputerName '%HOST%' -Port %PORT% -InformationLevel Detailed"

echo.
echo [3/3] Diagnosa cepat
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "$hostIp='%HOST%'; $port=%PORT%; $ok=(Test-NetConnection -ComputerName $hostIp -Port $port -InformationLevel Quiet); if($ok){ Write-Host 'OK: IP bisa dijangkau dan port terbuka.' -ForegroundColor Green } else { Write-Host 'PORT BELUM TERBUKA: IP bisa hidup, tapi port mesin fingerprint belum bisa diakses.' -ForegroundColor Yellow; if($hostIp -match '^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.'){ Write-Host 'Ini IP Tailscale. Kalau IP ini milik PC, aktifkan portproxy atau subnet route ke IP lokal mesin fingerprint.' -ForegroundColor Cyan } }"

echo.
echo Selesai.
if "%PAUSE_AT_END%"=="1" pause

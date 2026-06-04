@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Setup Portproxy Fingerprint - Jalankan sebagai Administrator

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo File ini harus dijalankan sebagai Administrator.
  echo Klik kanan file ini lalu pilih "Run as administrator".
  echo.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  Setup Portproxy Fingerprint via Tailscale
echo ============================================================
echo.
echo Dipakai di PC Windows yang satu jaringan dengan mesin fingerprint.
echo Contoh:
echo  IP Tailscale PC ini       : 100.113.92.55
echo  IP lokal mesin fingerprint: 192.168.1.200
echo  Listen port               : 4370
echo  Connect port              : 4370
echo.

set /p "LISTEN_IP=Masukkan IP Tailscale PC ini: "
set /p "LISTEN_PORT=Masukkan listen port [4370]: "
set /p "DEVICE_IP=Masukkan IP lokal mesin fingerprint: "
set /p "DEVICE_PORT=Masukkan port mesin fingerprint [4370]: "

if "%LISTEN_PORT%"=="" set "LISTEN_PORT=4370"
if "%DEVICE_PORT%"=="" set "DEVICE_PORT=4370"

echo.
echo [1/5] Cek koneksi PC ini ke mesin fingerprint lokal
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "Test-NetConnection -ComputerName '%DEVICE_IP%' -Port %DEVICE_PORT% -InformationLevel Detailed"

echo.
echo [2/5] Aktifkan service IP Helper
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Service iphlpsvc -StartupType Automatic; Start-Service iphlpsvc"

echo.
echo [3/5] Tambah portproxy
echo ------------------------------------------------------------
netsh interface portproxy delete v4tov4 listenaddress=%LISTEN_IP% listenport=%LISTEN_PORT% >nul 2>&1
netsh interface portproxy add v4tov4 listenaddress=%LISTEN_IP% listenport=%LISTEN_PORT% connectaddress=%DEVICE_IP% connectport=%DEVICE_PORT%

echo.
echo [4/5] Buka firewall Windows untuk port %LISTEN_PORT%
echo ------------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -Command "$name='Fingerprint %LISTEN_PORT% via Tailscale'; if(Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue){ Remove-NetFirewallRule -DisplayName $name }; New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalAddress '%LISTEN_IP%' -LocalPort %LISTEN_PORT%"

echo.
echo [5/5] Tampilkan hasil portproxy
echo ------------------------------------------------------------
netsh interface portproxy show all

echo.
echo Selesai.
echo Dari PC XAMPP/aplikasi, tes target:
echo   %LISTEN_IP%:%LISTEN_PORT%
echo.
pause

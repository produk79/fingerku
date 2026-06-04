@echo off
setlocal EnableExtensions
title Stop CSL Fingerprint JS
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -Command "$root=(Resolve-Path '.').Path; $items=Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -like '*server.js*' -and $_.CommandLine -like ('*' + $root + '*') }; if(!$items){ Write-Host 'Tidak ada server JS aplikasi ini yang berjalan.'; exit 0 }; $items | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host ('Stopped node PID ' + $_.ProcessId) }"

pause

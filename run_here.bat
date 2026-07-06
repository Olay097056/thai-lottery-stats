@echo off
setlocal
set "PORT=8509"
if not "%~1"=="" set "PORT=%~1"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run_here.ps1" -Port %PORT%
pause

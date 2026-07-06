@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
set PORT=8509
if not "%~1"=="" set "PORT=%~1"

REM Find Python
set "PYEXE="
where py >nul 2>nul && set "PYEXE=py"
if not defined PYEXE where python >nul 2>nul && set "PYEXE=python"
if not defined PYEXE if exist "%LOCALAPPDATA%\lottery_stats_runtime\.venv\Scripts\python.exe" (
    set "PYEXE=%LOCALAPPDATA%\lottery_stats_runtime\.venv\Scripts\python.exe"
)
if not defined PYEXE (
    echo.
    echo [ERROR] Python not found.
    echo Install from https://www.python.org/downloads/
    echo Or double-click run_here.bat for automatic setup.
    echo.
    pause
    exit /b 1
)

echo Using Python: %PYEXE%

REM Install dependencies if missing
"%PYEXE%" -c "import fastapi, uvicorn, pandas, sklearn" >nul 2>&1
if errorlevel 1 (
    echo.
    echo Installing dependencies...
    "%PYEXE%" -m pip install -r "%~dp0requirements-api.txt"
    if errorlevel 1 (
        echo.
        echo [ERROR] Failed to install dependencies. Try run_here.bat instead.
        pause
        exit /b 1
    )
)

REM Quick import check
"%PYEXE%" -c "import main" >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Cannot import main.py:
    "%PYEXE%" -c "import main"
    pause
    exit /b 1
)

REM Find free port 8509-8515
:tryport
netstat -ano | findstr /C:":%PORT% " | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
    echo Port %PORT% is busy, trying next...
    set /a PORT+=1
    if !PORT! GTR 8515 goto portfail
    goto tryport
)

echo.
echo Thai Lottery Dashboard
echo URL: http://localhost:%PORT%
echo Press Ctrl+C to stop
echo.
start "" "http://localhost:%PORT%"
"%PYEXE%" -m uvicorn main:app --host 127.0.0.1 --port %PORT% --reload
pause
exit /b 0

:portfail
echo.
echo [ERROR] Ports 8509-8515 are all in use. Close other apps and retry.
pause
exit /b 1

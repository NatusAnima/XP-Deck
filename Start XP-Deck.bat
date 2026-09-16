@echo off
title XP-Deck
cd /d "%~dp0"

echo.
echo   ==========================================
echo      XP-Deck - Video Game Archive ^& Swiper
echo   ==========================================
echo.

rem ---- find a Python 3.10+ -----------------------------------------------
set "PY="

py -3 -c "import sys; sys.exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>&1
if not errorlevel 1 set "PY=py -3"

if not defined PY (
  python -c "import sys; sys.exit(0 if sys.version_info>=(3,10) else 1)" >nul 2>&1
  if not errorlevel 1 set "PY=python"
)

if not defined PY (
  echo   Python 3.10 or newer is needed, and was not found.
  echo.
  echo   It is free and takes about a minute to install:
  echo.
  echo     1. The download page is opening for you now.
  echo     2. Run the installer you download.
  echo     3. IMPORTANT - tick "Add python.exe to PATH" on the first screen.
  echo     4. When it finishes, close this window and double-click
  echo        "Start XP-Deck.bat" again.
  echo.
  start "" https://www.python.org/downloads/
  echo   Press any key to close this window.
  pause >nul
  exit /b 1
)

rem ---- first run: build a private environment ------------------------------
set "FRESH="
if not exist ".venv\Scripts\python.exe" (
  echo   First run - setting things up. This happens only once.
  echo.
  %PY% -m venv .venv
  if errorlevel 1 (
    echo   Could not create the environment.
    echo   Try reinstalling Python, making sure "Add python.exe to PATH" is ticked.
    echo.
    pause >nul
    exit /b 1
  )
  set "FRESH=1"
)

set "VENV_PY=.venv\Scripts\python.exe"

rem ---- dependencies --------------------------------------------------------
"%VENV_PY%" -c "import fastapi, uvicorn, httpx, segno, dotenv" >nul 2>&1
if errorlevel 1 set "FRESH=1"

if defined FRESH (
  echo   Downloading the bits XP-Deck needs. Please wait...
  echo.
  "%VENV_PY%" -m pip install --upgrade pip --quiet --disable-pip-version-check
  "%VENV_PY%" -m pip install -r requirements.txt --quiet --disable-pip-version-check
  if errorlevel 1 (
    echo.
    echo   Downloading the dependencies failed.
    echo   Check your internet connection, then try again.
    echo.
    pause >nul
    exit /b 1
  )
  echo   Ready.
  echo.
)

rem ---- run -----------------------------------------------------------------
echo   Starting XP-Deck. Your browser will open in a moment.
echo.
echo   * Leave this window open while you are using XP-Deck.
echo   * Close it, or press Ctrl+C, when you are finished.
echo.

set XPDECK_OPEN_BROWSER=1
"%VENV_PY%" -m backend

echo.
echo   XP-Deck has stopped. Press any key to close this window.
pause >nul

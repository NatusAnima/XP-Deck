#!/usr/bin/env bash
# XP-Deck launcher for macOS and Linux.
# Double-click it, or run ./start-xp-deck.sh from a terminal.
set -euo pipefail
cd "$(dirname "$0")"

echo
echo "  =========================================="
echo "     XP-Deck - Video Game Archive & Swiper"
echo "  =========================================="
echo

# ---- find Python ----------------------------------------------------------
PY=""
for candidate in python3 python; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then
      PY="$candidate"; break
    fi
  fi
done

if [ -z "$PY" ]; then
  echo "  Python 3.10 or newer is required but was not found."
  echo
  echo "    macOS:  brew install python   (or get it from python.org/downloads)"
  echo "    Linux:  sudo apt install python3 python3-venv"
  echo
  exit 1
fi

# ---- first run: private environment ---------------------------------------
FRESH=""
if [ ! -x ".venv/bin/python" ]; then
  echo "  First run - setting up. This takes a minute, only happens once."
  echo
  "$PY" -m venv .venv
  FRESH=1
fi

VENV_PY=".venv/bin/python"

if [ -n "$FRESH" ]; then
  echo "  Downloading the bits XP-Deck needs..."
  "$VENV_PY" -m pip install --upgrade pip --quiet --disable-pip-version-check
  "$VENV_PY" -m pip install -r requirements.txt --quiet --disable-pip-version-check
  echo "  Done."
  echo
elif ! "$VENV_PY" -c "import fastapi, uvicorn, httpx, segno, dotenv" >/dev/null 2>&1; then
  echo "  Updating dependencies..."
  "$VENV_PY" -m pip install -r requirements.txt --quiet --disable-pip-version-check
  echo
fi

# ---- run ------------------------------------------------------------------
echo "  Starting XP-Deck. Your browser will open in a moment."
echo
echo "  Leave this window open while you use the app."
echo "  Press Ctrl+C when you are finished."
echo

export XPDECK_OPEN_BROWSER=1
exec "$VENV_PY" -m backend

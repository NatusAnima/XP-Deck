import os
from pathlib import Path
from dotenv import load_dotenv

# Project Root is the parent directory of backend/
BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
STATIC_DIR = PROJECT_ROOT / "static"
DATA_DIR = PROJECT_ROOT / "data"

# Ensure data directory exists
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Load environment variables from .env
load_dotenv(PROJECT_ROOT / ".env")

TWITCH_CLIENT_ID = os.getenv("TWITCH_CLIENT_ID", "").strip()
TWITCH_CLIENT_SECRET = os.getenv("TWITCH_CLIENT_SECRET", "").strip()
DATABASE_PATH = Path(os.getenv("DATABASE_PATH", str(DATA_DIR / "games.db")))

HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))

def has_twitch_credentials() -> bool:
    """Return True if both Twitch client ID and secret are non-empty."""
    return bool(TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET and 
                TWITCH_CLIENT_ID != "your_twitch_client_id_here")

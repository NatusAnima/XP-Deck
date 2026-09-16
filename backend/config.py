import os
from pathlib import Path

from dotenv import load_dotenv, set_key

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
STATIC_DIR = PROJECT_ROOT / "static"
DATA_DIR = PROJECT_ROOT / "data"
ENV_PATH = PROJECT_ROOT / ".env"

DATA_DIR.mkdir(parents=True, exist_ok=True)

# .env is optional: a first-time user has none until the setup wizard writes one.
load_dotenv(ENV_PATH)

# Placeholders shipped in .env.example - treated as "not configured".
PLACEHOLDERS = {"your_twitch_client_id_here", "your_twitch_client_secret_here", ""}

# Read as module globals rather than imported by name elsewhere, so the setup
# wizard can update them in place without a restart. Other modules must use
# `config.TWITCH_CLIENT_ID`, never `from .config import TWITCH_CLIENT_ID`.
TWITCH_CLIENT_ID = os.getenv("TWITCH_CLIENT_ID", "").strip()
TWITCH_CLIENT_SECRET = os.getenv("TWITCH_CLIENT_SECRET", "").strip()

DATABASE_PATH = Path(os.getenv("DATABASE_PATH", str(DATA_DIR / "games.db")))
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", "8000"))


def has_twitch_credentials() -> bool:
    """True when both Twitch credentials are set to something real."""
    return (TWITCH_CLIENT_ID not in PLACEHOLDERS
            and TWITCH_CLIENT_SECRET not in PLACEHOLDERS)


def save_twitch_credentials(client_id: str, client_secret: str) -> None:
    """Persist credentials to .env and apply them to the running process.

    Called by the setup wizard once Twitch has confirmed the pair is valid.
    """
    global TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET

    client_id = client_id.strip()
    client_secret = client_secret.strip()

    ENV_PATH.touch(exist_ok=True)
    # set_key rewrites just these keys, leaving anything else in .env alone
    set_key(str(ENV_PATH), "TWITCH_CLIENT_ID", client_id)
    set_key(str(ENV_PATH), "TWITCH_CLIENT_SECRET", client_secret)

    TWITCH_CLIENT_ID = client_id
    TWITCH_CLIENT_SECRET = client_secret
    os.environ["TWITCH_CLIENT_ID"] = client_id
    os.environ["TWITCH_CLIENT_SECRET"] = client_secret

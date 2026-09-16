import time
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import httpx
# imported as a module, not by name: the setup wizard rebinds these globals
# at runtime and `from ... import X` would freeze the old value.
from . import config

logger = logging.getLogger("xpdeck.igdb")

# httpx logs every request URL at INFO. Credentials are sent in the body rather
# than the query string (below), but keeping this at WARNING also stops routine
# request spam from burying the app's own messages.
logging.getLogger("httpx").setLevel(logging.WARNING)

TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
IGDB_GAMES_URL = "https://api.igdb.com/v4/games"
IGDB_COUNT_URL = "https://api.igdb.com/v4/games/count"
IMAGE_URL = "https://images.igdb.com/igdb/image/upload/t_1080p/{}.jpg"

# Main Game, Remake, Remaster, Expanded Game - filters out shovelware and DLC.
GAME_TYPES = "(0, 8, 9, 10)"

FIELDS = """fields id, name, summary, total_rating_count, rating, first_release_date,
       cover.image_id, screenshots.image_id, genres.name, platforms.name;"""

# One client for the process: reusing it keeps the connection pool and avoids a
# fresh TLS handshake on every deck fetch. Closed in the app's lifespan shutdown.
_client = httpx.AsyncClient(timeout=20.0)

_access_token: Optional[str] = None
_token_expires_at: float = 0.0


def reset_token() -> None:
    """Drop the cached token, e.g. after the credentials change."""
    global _access_token, _token_expires_at
    _access_token, _token_expires_at = None, 0.0


async def close_client() -> None:
    """Close the shared HTTP client. Called on application shutdown."""
    await _client.aclose()


async def _get_token(force_refresh: bool = False) -> Optional[str]:
    """Return a cached Twitch app token, fetching a new one when stale."""
    global _access_token, _token_expires_at

    if not config.has_twitch_credentials():
        return None

    now = time.time()
    # keep a 5 minute skew buffer so a token can't expire mid-request
    if not force_refresh and _access_token and now < _token_expires_at - 300:
        return _access_token

    try:
        resp = await _client.post(TWITCH_TOKEN_URL, data={
            "client_id": config.TWITCH_CLIENT_ID,
            "client_secret": config.TWITCH_CLIENT_SECRET,
            "grant_type": "client_credentials"
        })
        resp.raise_for_status()
        data = resp.json()
        _access_token = data.get("access_token")
        _token_expires_at = now + data.get("expires_in", 3600)
        logger.info("Twitch OAuth token acquired")
        return _access_token
    except httpx.HTTPError as e:
        logger.error("Failed to acquire Twitch OAuth token: %s", e)
        _access_token = None
        return None


async def verify_credentials(client_id: str, client_secret: str) -> Optional[str]:
    """Check a credential pair with Twitch without saving it.

    Returns None when they work, or a human-readable reason when they do not.
    """
    try:
        resp = await _client.post(TWITCH_TOKEN_URL, data={
            "client_id": client_id.strip(),
            "client_secret": client_secret.strip(),
            "grant_type": "client_credentials"
        })
    except httpx.HTTPError:
        return "Could not reach Twitch. Check your internet connection."

    if resp.status_code == 200 and resp.json().get("access_token"):
        return None
    if resp.status_code in (400, 401, 403):
        return "Twitch rejected these credentials. Check the Client ID and Secret."
    return f"Twitch returned an unexpected error (HTTP {resp.status_code})."


def _normalize(raw: Dict[str, Any], fallback_year: Optional[int]) -> Dict[str, Any]:
    """Transform an IGDB game into the shape upsert_cached_games expects."""
    release_year = fallback_year
    if raw.get("first_release_date"):
        release_year = datetime.fromtimestamp(
            raw["first_release_date"], tz=timezone.utc
        ).year

    cover = raw.get("cover") or {}
    cover_url = IMAGE_URL.format(cover["image_id"]) if cover.get("image_id") else None

    return {
        "igdb_id": raw["id"],
        "title": raw.get("name", "Untitled"),
        "release_year": release_year,
        "cover_url": cover_url,
        "screenshots": [
            IMAGE_URL.format(s["image_id"])
            for s in raw.get("screenshots", [])[:10]
            if s.get("image_id")
        ],
        "summary": raw.get("summary") or "",
        "genres": ", ".join(g["name"] for g in raw.get("genres", []) if g.get("name")),
        "platforms": ", ".join(p["name"] for p in raw.get("platforms", []) if p.get("name")),
        "total_rating_count": raw.get("total_rating_count") or 0,
        "rating": round(raw.get("rating") or 0.0, 1),
    }


async def _query(body: str) -> List[Dict[str, Any]]:
    """POST an Apicalypse query, refreshing the token once on a 401."""
    token = await _get_token()
    if not token:
        return []

    for attempt in (1, 2):
        headers = {
            "Client-ID": config.TWITCH_CLIENT_ID,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json"
        }
        try:
            resp = await _client.post(IGDB_GAMES_URL, headers=headers, content=body)
            # A revoked or rotated token 401s long before it is due to expire,
            # so drop the cached one and retry rather than failing for 60 days.
            if resp.status_code == 401 and attempt == 1:
                logger.warning("IGDB rejected the token; refreshing and retrying")
                token = await _get_token(force_refresh=True)
                if not token:
                    return []
                continue
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPError as e:
            logger.error("IGDB query failed: %s", e)
            return []
    return []


def _year_filter(year: int) -> str:
    """The where-clause shared by the deck query and the year count, so the
    total always describes exactly the set the deck draws from."""
    start = int(datetime(year, 1, 1, tzinfo=timezone.utc).timestamp())
    end = int(datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc).timestamp())
    return (f"where first_release_date >= {start} & first_release_date <= {end}"
            f" & (game_type = {GAME_TYPES} | game_type = null)"
            " & version_parent = null;")


async def count_games_for_year(year: int) -> Optional[int]:
    """How many games IGDB lists for a year. None if it could not be fetched."""
    token = await _get_token()
    if not token:
        return None

    headers = {
        "Client-ID": config.TWITCH_CLIENT_ID,
        "Authorization": f"Bearer {token}",
        "Accept": "application/json"
    }
    try:
        resp = await _client.post(IGDB_COUNT_URL, headers=headers, content=_year_filter(year))
        resp.raise_for_status()
        total = resp.json().get("count")
        logger.info("IGDB lists %s games for %d", total, year)
        return total
    except (httpx.HTTPError, ValueError) as e:
        logger.error("IGDB count failed for %d: %s", year, e)
        return None


async def fetch_top_games_for_year(year: int, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
    """Fetch the most-reviewed games released in a year, newest cursor first."""
    games = await _query(f"""
    {FIELDS}
    {_year_filter(year)}
    sort total_rating_count desc;
    limit {limit};
    offset {offset};
    """.strip())

    logger.info("Fetched %d games from IGDB for %d (offset %d)", len(games), year, offset)
    return [_normalize(g, year) for g in games]


async def search_games(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Search IGDB by title across all years."""
    # Apicalypse string literals are double-quoted; strip quotes and backslashes
    # so a title containing them can't terminate the literal early.
    safe = query.replace("\\", "").replace('"', "")[:100]
    if not safe.strip():
        return []

    games = await _query(f"""
    {FIELDS}
    search "{safe}";
    where (game_type = {GAME_TYPES} | game_type = null) & version_parent = null;
    limit {limit};
    """.strip())

    logger.info("IGDB search for %r returned %d games", safe, len(games))
    # Search spans every year, so there is no year to fall back to. A game with
    # no release date is cached with release_year NULL, which keeps it out of
    # the year decks and the per-year stats rather than landing it in "year 0".
    return [_normalize(g, None) for g in games]

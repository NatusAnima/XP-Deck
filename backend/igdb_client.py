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
IGDB_EXTERNAL_URL = "https://api.igdb.com/v4/external_games"

# IGDB's external_game_source id for Steam. The older "category" field is
# deprecated in this API version and matches nothing.
STEAM_SOURCE = 1

# IGDB caps a single response at 500 rows.
MAX_ROWS = 500
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


IGDB_GENRES_URL = "https://api.igdb.com/v4/genres"

# ORDER BY clauses the deck may request, mirrored in db.DECK_SORTS.
IGDB_SORTS = {
    "popular": "sort total_rating_count desc;",
    "rating": "sort rating desc;",
    "newest": "sort first_release_date desc;",
    "oldest": "sort first_release_date asc;",
}


async def _post(url: str, body: str) -> List[Dict[str, Any]]:
    """POST an Apicalypse query to any IGDB endpoint."""
    token = await _get_token()
    if not token:
        return []
    headers = {
        "Client-ID": config.TWITCH_CLIENT_ID,
        "Authorization": f"Bearer {token}",
        "Accept": "application/json"
    }
    try:
        resp = await _client.post(url, headers=headers, content=body)
        resp.raise_for_status()
        return resp.json()
    except (httpx.HTTPError, ValueError) as e:
        logger.error("IGDB request to %s failed: %s", url, e)
        return []


async def map_steam_appids(appids: List[int]) -> Dict[int, int]:
    """Map Steam app ids to IGDB game ids.

    Batched, because a Steam library is routinely hundreds of games and one
    lookup each would take minutes and hammer the rate limit.
    """
    mapping: Dict[int, int] = {}
    for i in range(0, len(appids), MAX_ROWS):
        chunk = appids[i:i + MAX_ROWS]
        uids = ",".join(f'"{a}"' for a in chunk)
        rows = await _post(IGDB_EXTERNAL_URL, (
            f"fields game, uid;"
            f" where external_game_source = {STEAM_SOURCE} & uid = ({uids});"
            f" limit {MAX_ROWS};"
        ))
        for row in rows:
            uid, game = row.get("uid"), row.get("game")
            if uid and game and str(uid).isdigit():
                mapping[int(uid)] = game

    logger.info("Matched %d of %d Steam apps to IGDB games", len(mapping), len(appids))
    return mapping


async def fetch_games_by_ids(igdb_ids: List[int]) -> List[Dict[str, Any]]:
    """Fetch full metadata for specific IGDB game ids."""
    games: List[Dict[str, Any]] = []
    for i in range(0, len(igdb_ids), MAX_ROWS):
        chunk = igdb_ids[i:i + MAX_ROWS]
        rows = await _post(IGDB_GAMES_URL, (
            f"{FIELDS} where id = ({','.join(str(g) for g in chunk)}); limit {MAX_ROWS};"
        ))
        games.extend(_normalize(g, None) for g in rows)
    return games


def _epoch(year: int, end: bool = False) -> int:
    return int((datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc) if end
                else datetime(year, 1, 1, tzinfo=timezone.utc)).timestamp())


def build_where(
    year_from: Optional[int] = None,
    year_to: Optional[int] = None,
    genre_id: Optional[int] = None,
    min_ratings: int = 0,
) -> str:
    """The where-clause shared by the deck fetch and the deck count.

    Both must use exactly the same conditions, or the progress bar counts a
    different set of games than the deck actually serves.
    """
    parts = [f"(game_type = {GAME_TYPES} | game_type = null)", "version_parent = null"]

    if year_from is not None:
        parts.append(f"first_release_date >= {_epoch(year_from)}")
    if year_to is not None:
        parts.append(f"first_release_date <= {_epoch(year_to, end=True)}")
    else:
        # An open-ended range still needs a lower bound on the field itself,
        # or games with no release date at all come back with a null year.
        parts.append("first_release_date != null")

    if genre_id:
        parts.append(f"genres = ({int(genre_id)})")
    if min_ratings > 0:
        parts.append(f"total_rating_count >= {int(min_ratings)}")

    return "where " + " & ".join(parts) + ";"


async def fetch_genres() -> List[Dict[str, Any]]:
    """The IGDB genre list. Small and effectively static."""
    rows = await _post(IGDB_GENRES_URL, "fields id, name; sort name asc; limit 100;")
    return [{"id": r["id"], "name": r["name"]} for r in rows if r.get("name")]


async def count_games(where: str) -> Optional[int]:
    """How many IGDB games match a where-clause."""
    token = await _get_token()
    if not token:
        return None
    headers = {
        "Client-ID": config.TWITCH_CLIENT_ID,
        "Authorization": f"Bearer {token}",
        "Accept": "application/json"
    }
    try:
        resp = await _client.post(IGDB_COUNT_URL, headers=headers, content=where)
        resp.raise_for_status()
        return resp.json().get("count")
    except (httpx.HTTPError, ValueError) as e:
        logger.error("IGDB count failed: %s", e)
        return None


async def fetch_games(where: str, sort: str = "popular", limit: int = 50,
                      offset: int = 0, fallback_year: Optional[int] = None) -> List[Dict[str, Any]]:
    """Fetch a page of games for a deck filter."""
    order = IGDB_SORTS.get(sort, IGDB_SORTS["popular"])
    games = await _post(IGDB_GAMES_URL, f"{FIELDS} {where} {order} limit {limit}; offset {offset};")
    logger.info("Fetched %d games from IGDB (sort=%s, offset=%d)", len(games), sort, offset)
    return [_normalize(g, fallback_year) for g in games]


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

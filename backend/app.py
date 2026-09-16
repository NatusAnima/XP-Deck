import io
import logging
import socket
from contextlib import asynccontextmanager
from typing import Optional, Literal, List, Dict, Any
from fastapi import FastAPI, Query, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import segno

from . import igdb_client
from . import steam_client
from . import config
from .config import STATIC_DIR, HOST, PORT, has_twitch_credentials
from .db import (
    init_db,
    upsert_cached_games,
    get_unswiped_games,
    search_cached_games,
    attach_swipe_status,
    game_exists,
    record_swipe,
    undo_last_swipe,
    get_stats,
    get_filter_total,
    set_filter_total,
    count_deck_games,
    DECK_SORTS,
    get_all_settings,
    set_setting,
    get_catalog_games,
    create_manual_game,
    find_game_by_title,
    record_swipes,
    get_game_by_id,
    update_swipe_item,
    delete_swipe_item,
    reset_swipes,
    factory_reset,
    SORT_OPTIONS,
)
from .export_service import export_clean_csv, export_json, export_playnite_csv

# uvicorn configures only the "uvicorn.*" loggers and leaves root without a
# handler, so app logs below WARNING would otherwise vanish - including the
# migration notice. basicConfig is a no-op if a handler already exists.
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(name)s: %(message)s")
logger = logging.getLogger("xpdeck.app")

Status = Literal["played", "skipped", "backlog"]
SORT_KEYS = set(DECK_SORTS)

# Refill the local cache from IGDB when the deck drops below this many cards.
REFILL_THRESHOLD = 10
IGDB_PAGE_SIZE = 50

EXPORT_FORMATS = {
    "csv": (export_clean_csv, "text/csv", "xp_deck_games.csv"),
    "json": (export_json, "application/json", "xp_deck_games.json"),
    "playnite": (export_playnite_csv, "text/csv", "xp_deck_playnite.csv"),
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    logger.info("XP-Deck ready on http://%s:%s", HOST, PORT)
    yield
    await igdb_client.close_client()
    await steam_client.close_client()


app = FastAPI(
    title="XP-Deck API",
    description="Backend for personal video game backlog swiping and archiving",
    version="1.0.0",
    lifespan=lifespan
)

# No CORS middleware: the frontend is served from this same origin, so every
# call is same-origin. Adding permissive CORS would expose the unauthenticated
# destructive endpoints (/api/reset) to any page the user happens to visit.


class SwipeFields(BaseModel):
    status: Status
    platform_played: Optional[str] = None
    hours_played: Optional[int] = Field(None, ge=0, le=99999)
    user_rating: Optional[int] = Field(None, ge=1, le=10)


class SwipeRequest(SwipeFields):
    igdb_id: int


class ResetRequest(BaseModel):
    scope: Literal["year", "all_swipes", "factory"]
    year: Optional[int] = None


class SettingsUpdateRequest(BaseModel):
    rating_duration_seconds: int = Field(..., ge=0, le=120)
    quick_tag_enabled: bool = True


class SetupRequest(BaseModel):
    client_id: str = Field(..., min_length=10, max_length=200)
    client_secret: str = Field(..., min_length=10, max_length=200)


class SteamKeyRequest(BaseModel):
    api_key: str = Field(..., min_length=16, max_length=64)


class SteamScanRequest(BaseModel):
    profile: str = Field(..., min_length=2, max_length=120)
    min_hours: float = Field(1.0, ge=0, le=10000)


class SteamImportEntry(BaseModel):
    igdb_id: int
    hours_played: Optional[int] = Field(None, ge=0, le=99999)


class SteamImportRequest(BaseModel):
    games: List[SteamImportEntry] = Field(..., max_length=5000)
    status: Status = "played"
    platform_played: Optional[str] = "PC (Steam)"


class ManualGameRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    release_year: Optional[int] = Field(None, ge=1950, le=2100)
    platforms: str = Field("", max_length=200)
    genres: str = Field("", max_length=200)
    summary: str = Field("", max_length=4000)


def _lan_ip() -> str:
    """Best guess at this machine's LAN address."""
    try:
        # no packets are sent; this just asks the OS which interface would route
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


@app.get("/api/setup")
async def setup_status():
    """Whether IGDB credentials are configured. Never returns the secret."""
    return {
        "configured": has_twitch_credentials(),
        # enough to confirm which app is wired up, not enough to reuse
        "client_id_hint": (config.TWITCH_CLIENT_ID[:6] + "..."
                           if has_twitch_credentials() else None),
    }


@app.post("/api/setup")
async def save_setup(payload: SetupRequest):
    """Verify a Twitch credential pair, then persist it to .env.

    Verified before saving so a typo surfaces immediately instead of turning
    into an app that silently never loads any games.
    """
    problem = await igdb_client.verify_credentials(payload.client_id, payload.client_secret)
    if problem:
        raise HTTPException(status_code=400, detail=problem)

    config.save_twitch_credentials(payload.client_id, payload.client_secret)
    igdb_client.reset_token()   # discard any token from the previous pair
    logger.info("IGDB credentials saved and verified")
    return {"success": True}


@app.get("/api/steam")
async def steam_status():
    """Steam import readiness. Never returns the API key itself."""
    return {
        "has_api_key": steam_client.has_api_key(),
        "profile": get_all_settings().get("steam_profile", ""),
    }


@app.post("/api/steam/key")
async def save_steam_key(payload: SteamKeyRequest):
    """Verify a Steam Web API key with Steam, then persist it."""
    problem = await steam_client.verify_api_key(payload.api_key)
    if problem:
        raise HTTPException(status_code=400, detail=problem)

    config.save_steam_api_key(payload.api_key)
    logger.info("Steam API key saved and verified")
    return {"success": True}


@app.post("/api/steam/scan")
async def steam_scan(payload: SteamScanRequest):
    """Read a Steam library and match it against IGDB, without importing.

    Deliberately a preview: a library is hundreds of games and a bulk write
    should be something the user sees and confirms first.
    """
    if not steam_client.has_api_key():
        raise HTTPException(status_code=400, detail="No Steam API key configured.")

    steam_id, error = await steam_client.resolve_steam_id(config.STEAM_API_KEY, payload.profile)
    if error:
        raise HTTPException(status_code=400, detail=error)

    owned, error = await steam_client.fetch_owned_games(config.STEAM_API_KEY, steam_id)
    if error:
        raise HTTPException(status_code=400, detail=error)

    set_setting("steam_profile", payload.profile.strip())

    min_minutes = payload.min_hours * 60
    kept = [g for g in owned if g["minutes"] >= min_minutes]

    mapping = await igdb_client.map_steam_appids([g["appid"] for g in kept])

    # Cache the matched games so the import can attach swipes to them
    new_ids = [i for i in set(mapping.values()) if not game_exists(i)]
    if new_ids:
        upsert_cached_games(await igdb_client.fetch_games_by_ids(new_ids))

    matched, unmatched = [], []
    for game in kept:
        igdb_id = mapping.get(game["appid"])
        cached = get_game_by_id(igdb_id) if igdb_id else None
        hours = round(game["minutes"] / 60)
        if cached:
            matched.append({
                "igdb_id": igdb_id,
                "title": cached["title"],
                "release_year": cached["release_year"],
                "cover_url": cached["cover_url"],
                "steam_name": game["name"],
                "hours_played": hours,
                "minutes": game["minutes"],
                "current_status": None,
            })
        else:
            unmatched.append({"appid": game["appid"], "name": game["name"], "hours_played": hours})

    for entry in attach_swipe_status(matched):
        entry["current_status"] = entry.pop("status", None)

    matched.sort(key=lambda g: g["minutes"], reverse=True)
    unmatched.sort(key=lambda g: g["hours_played"], reverse=True)

    return {
        "steam_id": steam_id,
        "total_owned": len(owned),
        "after_filter": len(kept),
        "matched": matched,
        "unmatched": unmatched,
    }


@app.post("/api/steam/import")
async def steam_import(payload: SteamImportRequest):
    """Write the games the user confirmed from a scan."""
    imported = record_swipes([
        {
            "igdb_id": g.igdb_id,
            "status": payload.status,
            "hours_played": g.hours_played,
            "platform_played": payload.platform_played,
        }
        for g in payload.games
    ])
    logger.info("Steam import: recorded %d games as %s", imported, payload.status)
    return {"success": True, "imported": imported}


@app.post("/api/games/manual")
async def add_manual_game(payload: ManualGameRequest):
    """Create a game IGDB does not have, so it can still be catalogued."""
    existing = find_game_by_title(payload.title)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f'"{existing["title"]}" is already in the database.'
        )

    game = create_manual_game(
        title=payload.title,
        release_year=payload.release_year,
        platforms=payload.platforms,
        genres=payload.genres,
        summary=payload.summary,
    )
    return {"success": True, "game": game}


@app.get("/api/network-info")
async def get_network_info():
    """Return the host's LAN IP and the URL a phone can reach it on."""
    ip = _lan_ip()
    return {"lan_ip": ip, "port": PORT, "lan_url": f"http://{ip}:{PORT}"}


@app.get("/api/qr")
async def qr_code():
    """QR code for the LAN URL, as SVG.

    Rendered locally with segno rather than fetched from a QR web service: the
    address of a machine on the user's private network should not be handed to
    a third party, and this keeps the feature working with no internet at all.
    """
    buf = io.BytesIO()
    segno.make(f"http://{_lan_ip()}:{PORT}", error="m").save(
        buf, kind="svg", scale=5, border=2, dark="#000000", light="#FFFFFF"
    )
    return Response(
        content=buf.getvalue(),
        media_type="image/svg+xml",
        # the LAN IP can change between sessions
        headers={"Cache-Control": "no-store"},
    )


@app.get("/api/settings")
async def get_settings():
    """Return current user settings."""
    return get_all_settings()


@app.post("/api/settings")
async def update_settings(payload: SettingsUpdateRequest):
    """Update quick-tag preferences."""
    set_setting("rating_duration_seconds", str(payload.rating_duration_seconds))
    # stored as "1"/"0": user_settings.value is TEXT
    set_setting("quick_tag_enabled", "1" if payload.quick_tag_enabled else "0")
    return {"success": True, "settings": get_all_settings()}


# Genres are a small, effectively static list; cached for the process so the
# filter dialog does not re-query IGDB on every page load.
_genre_cache: List[Dict[str, Any]] = []


@app.get("/api/genres")
async def list_genres():
    """The IGDB genre list, for the deck filter."""
    global _genre_cache
    if not _genre_cache and has_twitch_credentials():
        _genre_cache = await igdb_client.fetch_genres()
    return {"genres": _genre_cache}


def _genre_id(name: Optional[str]) -> Optional[int]:
    """Map a genre name back to its IGDB id, for the remote query."""
    if not name:
        return None
    return next((g["id"] for g in _genre_cache if g["name"] == name), None)


@app.get("/api/deck")
async def get_deck(
    year_from: Optional[int] = Query(None, ge=1950, le=2100),
    year_to: Optional[int] = Query(None, ge=1950, le=2100),
    genre: Optional[str] = Query(None, max_length=60),
    min_ratings: int = Query(0, ge=0, le=100000),
    sort: str = Query("popular"),
    limit: int = Query(30, ge=1, le=100),
    igdb_offset: int = Query(0, ge=0, description="Pagination cursor into IGDB's ranking"),
):
    """Return unswiped games matching the filter, topping up from IGDB.

    There is deliberately no offset into the local query: swiped games are
    excluded by the join, so the unswiped set is self-paginating. Paging it
    would skip games the user never saw as the set shrinks. `igdb_offset` is a
    separate cursor into IGDB's own ranking, used only to fetch more.
    """
    if sort not in SORT_KEYS:
        raise HTTPException(status_code=422, detail=f"Unknown sort: {sort}")
    if year_from is not None and year_to is not None and year_from > year_to:
        raise HTTPException(status_code=422, detail="year_from is after year_to")

    criteria = dict(year_from=year_from, year_to=year_to, genre=genre, min_ratings=min_ratings)
    games = get_unswiped_games(limit=limit, sort=sort, **criteria)
    has_more = True
    next_igdb_offset = igdb_offset

    if len(games) < REFILL_THRESHOLD and has_twitch_credentials():
        if not _genre_cache and genre:
            await list_genres()          # need the id to build the remote query
        where = igdb_client.build_where(year_from, year_to, _genre_id(genre), min_ratings)
        remote = await igdb_client.fetch_games(
            where, sort=sort, limit=IGDB_PAGE_SIZE, offset=igdb_offset, fallback_year=year_from
        )
        if remote:
            upsert_cached_games(remote)
            next_igdb_offset = igdb_offset + len(remote)
            games = get_unswiped_games(limit=limit, sort=sort, **criteria)
        else:
            # We asked IGDB for more and it had none, so this filter is
            # exhausted even if unswiped cards remain locally. Reporting it
            # here stops the client re-querying on every remaining swipe.
            has_more = False
    elif not games:
        has_more = has_twitch_credentials()

    # How many games match this filter at all, so the progress denominator is
    # fixed rather than growing with every page fetched. Counted once per
    # distinct filter and cached.
    signature = f"{year_from}|{year_to}|{genre}|{min_ratings}"
    total = get_filter_total(signature)
    if total is None and has_twitch_credentials():
        where = igdb_client.build_where(year_from, year_to, _genre_id(genre), min_ratings)
        total = await igdb_client.count_games(where)
        if total is not None:
            set_filter_total(signature, total)

    reviewed, cached = count_deck_games(**criteria)

    return {
        "games": games,
        "has_more": has_more,
        "igdb_offset": next_igdb_offset,
        "has_credentials": has_twitch_credentials(),
        "filter_total": total,
        "reviewed": reviewed,
        "cached": cached,
    }


@app.get("/api/search")
async def search(
    q: str = Query(..., min_length=2, max_length=100),
    include_logged: bool = Query(False, description="Also return games already in the archive")
):
    """Search games by title across all years, falling back to the local cache.

    Every result carries its current archive status, so callers can tell a new
    game from one already logged. The deck asks for unlogged games only; the
    Add Game dialog wants both, so it can show what is already there.
    """
    games = []
    if has_twitch_credentials():
        remote = await igdb_client.search_games(q)
        if remote:
            # caching them is what lets /api/swipe accept them afterwards
            upsert_cached_games(remote)
            games = attach_swipe_status(remote)

    if not games:
        games = search_cached_games(q, include_logged=include_logged)

    if not include_logged:
        games = [g for g in games if not g.get("status")]

    return {"query": q, "games": games, "has_credentials": has_twitch_credentials()}


@app.post("/api/swipe")
async def handle_swipe(payload: SwipeRequest):
    """Record a swipe."""
    if not game_exists(payload.igdb_id):
        raise HTTPException(status_code=404, detail="Game not in cache")

    return record_swipe(
        igdb_id=payload.igdb_id,
        status=payload.status,
        platform_played=payload.platform_played,
        hours_played=payload.hours_played,
        user_rating=payload.user_rating
    )


@app.post("/api/undo")
async def handle_undo():
    """Roll back the most recent swipe."""
    result = undo_last_swipe()
    if not result:
        return {"success": False, "message": "No swipes to undo"}
    return {"success": True, **result}


@app.get("/api/catalog")
async def get_catalog(
    status: Optional[Literal["all", "played", "backlog", "skipped"]] = None,
    search: Optional[str] = None,
    sort: str = Query("date_desc")
):
    """Return logged games with search, status filtering and sorting."""
    if sort not in SORT_OPTIONS:
        raise HTTPException(status_code=422, detail=f"Unknown sort: {sort}")

    games = get_catalog_games(status=status, search=search, sort_by=sort)
    return {
        "count": len(games),
        "games": games,
        # shown in the Explorer address bar, so it points at the real folder
        # rather than a made-up path
        "archive_path": str(config.PROJECT_ROOT),
    }


@app.put("/api/catalog/{igdb_id}")
async def update_catalog_item(igdb_id: int, payload: SwipeFields):
    """Edit a swipe record."""
    updated = update_swipe_item(
        igdb_id=igdb_id,
        status=payload.status,
        platform_played=payload.platform_played,
        hours_played=payload.hours_played,
        user_rating=payload.user_rating
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Swipe record not found")
    return {"success": True, "igdb_id": igdb_id}


@app.delete("/api/catalog/{igdb_id}")
async def delete_catalog_item(igdb_id: int):
    """Delete a swipe, returning the game to the deck."""
    if not delete_swipe_item(igdb_id):
        raise HTTPException(status_code=404, detail="Swipe record not found")
    return {"success": True, "igdb_id": igdb_id}


@app.post("/api/reset")
async def handle_reset(payload: ResetRequest):
    """Execute a scoped reset."""
    if payload.scope == "year":
        if payload.year is None:
            raise HTTPException(status_code=400, detail="Year required for a year-scoped reset")
        return {"success": True, "scope": "year", "year": payload.year,
                "deleted_swipes": reset_swipes(payload.year)}

    if payload.scope == "all_swipes":
        return {"success": True, "scope": "all_swipes", "deleted_swipes": reset_swipes()}

    factory_reset()
    return {"success": True, "scope": "factory", "message": "Factory reset complete"}


@app.get("/api/stats")
async def handle_stats():
    """Return swipe totals and a per-year breakdown."""
    return get_stats()


@app.get("/api/export")
async def handle_export(format: Literal["csv", "json", "playnite"] = "csv"):
    """Export logged games as clean CSV, structured JSON, or Playnite CSV."""
    render, media_type, filename = EXPORT_FORMATS[format]
    return Response(
        content=render(get_catalog_games()),
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )


class RevalidatingStaticFiles(StaticFiles):
    """Serve static assets with `Cache-Control: no-cache`.

    XP-Deck is updated by pulling new files, and browsers will happily keep a
    cached app.js while re-fetching index.html - which shows new markup wired
    to old code, so new buttons silently do nothing. `no-cache` still allows
    caching, it just forces a revalidation, so unchanged files cost a 304.
    """

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers["Cache-Control"] = "no-cache"
        return response


app.mount("/static", RevalidatingStaticFiles(directory=STATIC_DIR), name="static")

# Pages get the same treatment, for the same reason.
PAGE_HEADERS = {"Cache-Control": "no-cache"}


@app.get("/catalog")
async def catalog_page():
    """Serve the Windows Explorer style catalog page."""
    return FileResponse(STATIC_DIR / "catalog.html", headers=PAGE_HEADERS)


@app.get("/")
async def root():
    """Serve the main application frame."""
    return FileResponse(STATIC_DIR / "index.html", headers=PAGE_HEADERS)

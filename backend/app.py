import io
import logging
import socket
from contextlib import asynccontextmanager
from typing import Optional, Literal
from fastapi import FastAPI, Query, HTTPException, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import segno

from . import igdb_client
from . import config
from .config import STATIC_DIR, HOST, PORT, has_twitch_credentials
from .db import (
    init_db,
    upsert_cached_games,
    get_unswiped_games,
    search_cached_games,
    game_exists,
    record_swipe,
    undo_last_swipe,
    get_stats,
    get_all_settings,
    set_setting,
    get_catalog_games,
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


class SetupRequest(BaseModel):
    client_id: str = Field(..., min_length=10, max_length=200)
    client_secret: str = Field(..., min_length=10, max_length=200)


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
    """Update the quick-tag auto-save duration."""
    set_setting("rating_duration_seconds", str(payload.rating_duration_seconds))
    return {"success": True, "settings": get_all_settings()}


@app.get("/api/deck")
async def get_deck(
    year: int = Query(..., ge=1970, le=2030),
    limit: int = Query(30, ge=1, le=100),
    igdb_offset: int = Query(0, ge=0, description="Pagination cursor into IGDB's ranking")
):
    """Return unswiped games for a year, topping up from IGDB when it runs low.

    There is deliberately no offset into the local query: swiped games are
    excluded by the join, so the unswiped set is self-paginating. Paging it
    would skip games the user never saw as the set shrinks. `igdb_offset` is a
    separate cursor into IGDB's own ranking, used only to fetch more.
    """
    games = get_unswiped_games(year, limit=limit)
    has_more = True
    next_igdb_offset = igdb_offset

    if len(games) < REFILL_THRESHOLD and has_twitch_credentials():
        remote = await igdb_client.fetch_top_games_for_year(
            year, limit=IGDB_PAGE_SIZE, offset=igdb_offset
        )
        if remote:
            upsert_cached_games(remote)
            next_igdb_offset = igdb_offset + len(remote)
            games = get_unswiped_games(year, limit=limit)
        else:
            # We asked IGDB for more and it had none, so this year is finished
            # even if unswiped cards remain locally. Reporting has_more here
            # stops the client re-querying IGDB on every one of those swipes.
            has_more = False
    elif not games:
        # nothing cached and no way to fetch more
        has_more = has_twitch_credentials()

    return {
        "games": games,
        "has_more": has_more,
        "igdb_offset": next_igdb_offset,
        "has_credentials": has_twitch_credentials(),
    }


@app.get("/api/search")
async def search(q: str = Query(..., min_length=2, max_length=100)):
    """Search games by title across all years, falling back to the local cache."""
    games = []
    if has_twitch_credentials():
        remote = await igdb_client.search_games(q)
        if remote:
            upsert_cached_games(remote)
            games = remote

    if not games:
        games = search_cached_games(q)

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
    return {"count": len(games), "games": games}


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


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/catalog")
async def catalog_page():
    """Serve the Windows Explorer style catalog page."""
    return FileResponse(STATIC_DIR / "catalog.html")


@app.get("/")
async def root():
    """Serve the main application frame."""
    return FileResponse(STATIC_DIR / "index.html")

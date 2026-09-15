import logging
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, Query, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .config import (
    STATIC_DIR, 
    HOST, 
    PORT, 
    has_twitch_credentials,
    DATABASE_PATH
)
from .db import (
    init_db,
    seed_database_if_empty,
    get_unswiped_games,
    count_cached_games_for_year,
    upsert_cached_games,
    record_swipe,
    undo_last_swipe,
    get_stats,
    get_all_swiped_records,
    get_all_settings,
    set_setting
)
from .igdb_client import igdb_client
from .export_service import export_clean_csv, export_json, export_playnite_csv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("xpdeck.app")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Initializing XP-Deck SQLite Database...")
    init_db()
    seed_database_if_empty()
    logger.info("XP-Deck Backend ready on http://%s:%s", HOST, PORT)
    yield
    # Shutdown
    logger.info("XP-Deck shutting down...")

app = FastAPI(
    title="XP-Deck API",
    description="Backend for personal video game backlog swiping and archiving",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware for local development / LAN flexibility
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic Schemas
class SwipeRequest(BaseModel):
    igdb_id: int
    status: str = Field(..., description="Must be 'played', 'skipped', or 'backlog'")
    platform_played: Optional[str] = None
    hours_played: Optional[int] = None
    user_rating: Optional[int] = Field(None, ge=1, le=10)

class CatalogUpdateRequest(BaseModel):
    status: str = Field(..., description="Must be 'played', 'skipped', or 'backlog'")
    platform_played: Optional[str] = None
    hours_played: Optional[int] = None
    user_rating: Optional[int] = Field(None, ge=1, le=10)

class ResetRequest(BaseModel):
    scope: str = Field(..., description="'year', 'all_swipes', or 'factory'")
    year: Optional[int] = None

class SettingsUpdateRequest(BaseModel):
    rating_duration_seconds: int = Field(10, ge=0, le=120)

# Endpoints
@app.get("/api/status")
async def get_system_status():
    """Return backend status, database info, and IGDB credentials status."""
    has_keys = has_twitch_credentials()
    stats = get_stats()
    settings = get_all_settings()
    return {
        "status": "online",
        "has_twitch_credentials": has_keys,
        "database": str(DATABASE_PATH),
        "total_swiped": stats["total_swipes"],
        "counts": stats["status_counts"],
        "settings": settings
    }

@app.get("/api/network-info")
async def get_network_info():
    """Return host local IP and mobile LAN access URL."""
    import socket
    lan_ip = "127.0.0.1"
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        lan_ip = s.getsockname()[0]
        s.close()
    except Exception:
        pass
    
    return {
        "lan_ip": lan_ip,
        "port": PORT,
        "lan_url": f"http://{lan_ip}:{PORT}"
    }

@app.get("/api/settings")
async def get_settings():
    """Return current user settings."""
    return get_all_settings()

@app.post("/api/settings")
async def update_settings(payload: SettingsUpdateRequest):
    """Update user settings such as rating popover duration."""
    set_setting("rating_duration_seconds", str(payload.rating_duration_seconds))
    return {"success": True, "settings": get_all_settings()}

@app.get("/api/deck")
async def get_deck(
    year: int = Query(..., ge=1970, le=2030, description="Release year to fetch"),
    limit: int = Query(30, ge=1, le=100, description="Number of games to return"),
    offset: int = Query(0, ge=0, description="Offset for pagination")
):
    """
    Fetch unswiped games for the selected year.
    Pre-caches from IGDB if local cache has few unswiped items.
    """
    unswiped = get_unswiped_games(year, limit=limit, offset=offset)
    
    # If fewer than 10 unswiped games exist and we have Twitch credentials, fetch from IGDB
    if len(unswiped) < 10 and has_twitch_credentials():
        logger.info("Fetching additional games from IGDB for year %d (offset %d)...", year, offset)
        remote_games = await igdb_client.fetch_top_games_for_year(year, limit=50, offset=offset)
        if remote_games:
            upsert_cached_games(remote_games)
            unswiped = get_unswiped_games(year, limit=limit, offset=offset)

    return {
        "year": year,
        "count": len(unswiped),
        "offset": offset,
        "games": unswiped
    }

@app.post("/api/swipe")
async def handle_swipe(payload: SwipeRequest):
    """Record a user swipe action."""
    if payload.status not in ('played', 'skipped', 'backlog'):
        raise HTTPException(status_code=400, detail="Invalid status. Choose played, skipped, or backlog.")
    
    result = record_swipe(
        igdb_id=payload.igdb_id,
        status=payload.status,
        platform_played=payload.platform_played,
        hours_played=payload.hours_played,
        user_rating=payload.user_rating
    )
    return result

@app.post("/api/undo")
async def handle_undo():
    """Roll back the most recent swipe action."""
    result = undo_last_swipe()
    if not result:
        return {"success": False, "message": "No swipes to undo"}
    return {"success": True, **result}

# Catalog Explorer Endpoints
@app.get("/api/catalog")
async def get_catalog(
    status: Optional[str] = Query(None, description="Filter by status ('all', 'played', 'backlog', 'skipped')"),
    search: Optional[str] = Query(None, description="Search by title substring"),
    sort: str = Query("date_desc", description="Sorting field (date_desc, date_asc, title_asc, year_desc, rating_desc, hours_desc)")
):
    """Retrieve cataloged games with search, status filtering, and sorting."""
    from .db import get_catalog_games
    games = get_catalog_games(status=status, search=search, sort_by=sort)
    return {
        "count": len(games),
        "games": games
    }

@app.put("/api/catalog/{igdb_id}")
async def update_catalog_item(igdb_id: int, payload: CatalogUpdateRequest):
    """Edit swipe record for a game in the catalog."""
    from .db import update_swipe_item
    success = update_swipe_item(
        igdb_id=igdb_id,
        status=payload.status,
        platform_played=payload.platform_played,
        hours_played=payload.hours_played,
        user_rating=payload.user_rating
    )
    if not success:
        raise HTTPException(status_code=404, detail="Swipe record not found")
    return {"success": True, "igdb_id": igdb_id}

@app.delete("/api/catalog/{igdb_id}")
async def delete_catalog_item(igdb_id: int):
    """Delete a swipe record, returning the game back to the unswiped pool."""
    from .db import delete_swipe_item
    success = delete_swipe_item(igdb_id)
    if not success:
        raise HTTPException(status_code=404, detail="Swipe record not found")
    return {"success": True, "igdb_id": igdb_id, "message": "Swipe removed and game returned to deck"}

# Danger Zone Reset Endpoint
@app.post("/api/reset")
async def handle_reset(payload: ResetRequest):
    """Execute scoped resets."""
    from .db import reset_year_swipes, reset_all_swipes, factory_reset
    if payload.scope == "year":
        if not payload.year:
            raise HTTPException(status_code=400, detail="Year must be specified for year-scoped reset")
        deleted = reset_year_swipes(payload.year)
        return {"success": True, "scope": "year", "year": payload.year, "deleted_swipes": deleted}
    elif payload.scope == "all_swipes":
        deleted = reset_all_swipes()
        return {"success": True, "scope": "all_swipes", "deleted_swipes": deleted}
    elif payload.scope == "factory":
        factory_reset()
        return {"success": True, "scope": "factory", "message": "Factory reset complete"}
    else:
        raise HTTPException(status_code=400, detail="Invalid reset scope. Choose 'year', 'all_swipes', or 'factory'.")

@app.get("/api/stats")
async def handle_stats():
    """Return aggregated review statistics."""
    return get_stats()

@app.get("/api/export")
async def handle_export(
    format: str = Query("csv", regex="^(csv|json|playnite)$", description="Export format")
):
    """Export logged games in Clean CSV, JSON, or Playnite CSV format."""
    records = get_all_swiped_records()
    
    if format == "json":
        data = export_json(records)
        return Response(
            content=data,
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=xp_deck_games.json"}
        )
    elif format == "playnite":
        data = export_playnite_csv(records)
        return Response(
            content=data,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=xp_deck_playnite.csv"}
        )
    else: # Clean CSV
        data = export_clean_csv(records)
        return Response(
            content=data,
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=xp_deck_games.csv"}
        )

# Mount static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def root():
    """Serve main SPA frame."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "XP-Deck API is running. index.html not yet created."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app:app", host=HOST, port=PORT, reload=True)

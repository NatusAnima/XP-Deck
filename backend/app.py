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
    get_all_swiped_records
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

# Endpoints
@app.get("/api/status")
async def get_system_status():
    """Return backend status, database info, and IGDB credentials status."""
    has_keys = has_twitch_credentials()
    stats = get_stats()
    return {
        "status": "online",
        "has_twitch_credentials": has_keys,
        "database": str(DATABASE_PATH),
        "total_swiped": stats["total_swipes"],
        "counts": stats["status_counts"]
    }

@app.get("/api/deck")
async def get_deck(
    year: int = Query(..., ge=1970, le=2030, description="Release year to fetch"),
    limit: int = Query(30, ge=1, le=100, description="Number of games to return")
):
    """
    Fetch unswiped games for the selected year.
    Pre-caches from IGDB if local cache has few unswiped items.
    """
    # 1. Fetch unswiped games currently in database
    unswiped = get_unswiped_games(year, limit=limit)
    
    # 2. If fewer than 10 unswiped games remain and we have Twitch credentials, fetch from IGDB
    if len(unswiped) < 10 and has_twitch_credentials():
        logger.info("Fetching additional games from IGDB for year %d (currently unswiped: %d)...", year, len(unswiped))
        remote_games = await igdb_client.fetch_top_games_for_year(year, limit=50)
        if remote_games:
            upsert_cached_games(remote_games)
            # Re-query unswiped games after caching
            unswiped = get_unswiped_games(year, limit=limit)

    return {
        "year": year,
        "count": len(unswiped),
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

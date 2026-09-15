import sqlite3
import json
import logging
from typing import Optional, List, Dict, Any
from .config import DATABASE_PATH

logger = logging.getLogger("xpdeck.db")

def get_connection() -> sqlite3.Connection:
    """Return SQLite connection configured with Row factory and WAL mode."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def init_db():
    """Create tables and indexes if they do not already exist."""
    with get_connection() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS cached_games (
            igdb_id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            release_year INTEGER,
            cover_url TEXT,
            screenshots TEXT,       -- JSON array of image URLs
            summary TEXT,
            genres TEXT,            -- Comma-separated or JSON array
            platforms TEXT,         -- Comma-separated or JSON array
            total_rating_count INTEGER DEFAULT 0,
            rating REAL DEFAULT 0,
            raw_payload TEXT        -- Complete IGDB JSON response
        );

        CREATE TABLE IF NOT EXISTS user_swipes (
            igdb_id INTEGER PRIMARY KEY,
            status TEXT CHECK(status IN ('played', 'skipped', 'backlog')),
            platform_played TEXT,   -- Optional: e.g., 'Xbox 360', 'PC', 'PS4'
            hours_played INTEGER,   -- Optional estimation
            user_rating INTEGER,    -- Optional: 1-10
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(igdb_id) REFERENCES cached_games(igdb_id)
        );

        CREATE TABLE IF NOT EXISTS swipe_history (
            history_id INTEGER PRIMARY KEY AUTOINCREMENT,
            igdb_id INTEGER,
            action TEXT,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS user_settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_cached_year ON cached_games(release_year);
        CREATE INDEX IF NOT EXISTS idx_cached_rating_count ON cached_games(total_rating_count DESC);
        CREATE INDEX IF NOT EXISTS idx_swipes_status ON user_swipes(status);
        CREATE INDEX IF NOT EXISTS idx_history_id ON swipe_history(history_id DESC);
        """)
        
        # Default setting for rating duration if not already set
        conn.execute("INSERT OR IGNORE INTO user_settings (key, value) VALUES ('rating_duration_seconds', '10')")
    logger.info("Database initialized successfully at %s", DATABASE_PATH)

def upsert_cached_games(games: List[Dict[str, Any]]) -> int:
    """Insert or update batch of games fetched from IGDB or seeds."""
    if not games:
        return 0

    inserted_count = 0
    with get_connection() as conn:
        for g in games:
            igdb_id = g.get("igdb_id") or g.get("id")
            title = g.get("title") or g.get("name", "Unknown Title")
            release_year = g.get("release_year")
            cover_url = g.get("cover_url")
            
            # Handle screenshots list/json
            screenshots = g.get("screenshots", [])
            if isinstance(screenshots, list):
                screenshots_json = json.dumps(screenshots)
            elif isinstance(screenshots, str):
                screenshots_json = screenshots
            else:
                screenshots_json = "[]"

            # Handle genres
            genres = g.get("genres", "")
            if isinstance(genres, list):
                genres_str = ", ".join(genres)
            else:
                genres_str = str(genres) if genres else ""

            # Handle platforms
            platforms = g.get("platforms", "")
            if isinstance(platforms, list):
                platforms_str = ", ".join(platforms)
            else:
                platforms_str = str(platforms) if platforms else ""

            summary = g.get("summary", "")
            total_rating_count = g.get("total_rating_count", 0) or 0
            rating = g.get("rating", 0.0) or 0.0
            
            raw_payload = g.get("raw_payload", "")
            if isinstance(raw_payload, dict):
                raw_payload_str = json.dumps(raw_payload)
            elif isinstance(raw_payload, str):
                raw_payload_str = raw_payload
            else:
                raw_payload_str = json.dumps(g)

            conn.execute("""
                INSERT INTO cached_games (
                    igdb_id, title, release_year, cover_url, screenshots, 
                    summary, genres, platforms, total_rating_count, rating, raw_payload
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(igdb_id) DO UPDATE SET
                    title=excluded.title,
                    release_year=excluded.release_year,
                    cover_url=excluded.cover_url,
                    screenshots=excluded.screenshots,
                    summary=excluded.summary,
                    genres=excluded.genres,
                    platforms=excluded.platforms,
                    total_rating_count=excluded.total_rating_count,
                    rating=excluded.rating,
                    raw_payload=excluded.raw_payload
            """, (
                igdb_id, title, release_year, cover_url, screenshots_json,
                summary, genres_str, platforms_str, total_rating_count, rating, raw_payload_str
            ))
            inserted_count += 1
    return inserted_count

def get_unswiped_games(year: int, limit: int = 30, offset: int = 0) -> List[Dict[str, Any]]:
    """Retrieve next unswiped games for a given year sorted by popularity."""
    with get_connection() as conn:
        cursor = conn.execute("""
            SELECT g.* 
            FROM cached_games g
            LEFT JOIN user_swipes s ON g.igdb_id = s.igdb_id
            WHERE s.igdb_id IS NULL AND g.release_year = ?
            ORDER BY g.total_rating_count DESC, g.rating DESC
            LIMIT ? OFFSET ?
        """, (year, limit, offset))
        
        results = []
        for row in cursor.fetchall():
            item = dict(row)
            try:
                item["screenshots"] = json.loads(item["screenshots"])
            except Exception:
                item["screenshots"] = []
            results.append(item)
        return results

def get_game_by_id(igdb_id: int) -> Optional[Dict[str, Any]]:
    """Fetch single game by IGDB ID."""
    with get_connection() as conn:
        cursor = conn.execute("SELECT * FROM cached_games WHERE igdb_id = ?", (igdb_id,))
        row = cursor.fetchone()
        if not row:
            return None
        item = dict(row)
        try:
            item["screenshots"] = json.loads(item["screenshots"])
        except Exception:
            item["screenshots"] = []
        return item

def count_cached_games_for_year(year: int) -> int:
    """Return count of cached games for a given release year."""
    with get_connection() as conn:
        cursor = conn.execute("SELECT COUNT(*) FROM cached_games WHERE release_year = ?", (year,))
        return cursor.fetchone()[0]

def record_swipe(
    igdb_id: int, 
    status: str, 
    platform_played: Optional[str] = None, 
    hours_played: Optional[int] = None, 
    user_rating: Optional[int] = None
) -> Dict[str, Any]:
    """Record or update user swipe and add to swipe history."""
    if status not in ('played', 'skipped', 'backlog'):
        raise ValueError(f"Invalid swipe status: {status}")

    with get_connection() as conn:
        conn.execute("""
            INSERT INTO user_swipes (igdb_id, status, platform_played, hours_played, user_rating, created_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(igdb_id) DO UPDATE SET
                status=excluded.status,
                platform_played=excluded.platform_played,
                hours_played=excluded.hours_played,
                user_rating=excluded.user_rating,
                created_at=CURRENT_TIMESTAMP
        """, (igdb_id, status, platform_played, hours_played, user_rating))
        
        conn.execute("""
            INSERT INTO swipe_history (igdb_id, action)
            VALUES (?, ?)
        """, (igdb_id, status))

    return {
        "success": True,
        "igdb_id": igdb_id,
        "status": status,
        "platform_played": platform_played,
        "hours_played": hours_played,
        "user_rating": user_rating
    }

def undo_last_swipe() -> Optional[Dict[str, Any]]:
    """Revert the most recent swipe action from history and user_swipes."""
    with get_connection() as conn:
        cursor = conn.execute("SELECT history_id, igdb_id, action FROM swipe_history ORDER BY history_id DESC LIMIT 1")
        row = cursor.fetchone()
        if not row:
            return None
        
        history_id = row["history_id"]
        igdb_id = row["igdb_id"]
        action = row["action"]
        
        # Delete the swipe and history entries
        conn.execute("DELETE FROM swipe_history WHERE history_id = ?", (history_id,))
        conn.execute("DELETE FROM user_swipes WHERE igdb_id = ?", (igdb_id,))
    
    # Retrieve game info to return to client
    restored_game = get_game_by_id(igdb_id)
    return {
        "restored_game": restored_game,
        "undone_action": action,
        "igdb_id": igdb_id
    }

def get_stats() -> Dict[str, Any]:
    """Compute overall stats and breakdown by release year."""
    with get_connection() as conn:
        # Totals by status
        cursor = conn.execute("""
            SELECT status, COUNT(*) as count 
            FROM user_swipes 
            GROUP BY status
        """)
        status_counts = {"played": 0, "skipped": 0, "backlog": 0}
        total_swipes = 0
        for row in cursor.fetchall():
            st = row["status"]
            cnt = row["count"]
            status_counts[st] = cnt
            total_swipes += cnt

        # Breakdown per year
        cursor = conn.execute("""
            SELECT 
                g.release_year,
                COUNT(g.igdb_id) as total_cached,
                COUNT(s.igdb_id) as total_swiped,
                SUM(CASE WHEN s.status = 'played' THEN 1 ELSE 0 END) as played_count,
                SUM(CASE WHEN s.status = 'skipped' THEN 1 ELSE 0 END) as skipped_count,
                SUM(CASE WHEN s.status = 'backlog' THEN 1 ELSE 0 END) as backlog_count
            FROM cached_games g
            LEFT JOIN user_swipes s ON g.igdb_id = s.igdb_id
            WHERE g.release_year IS NOT NULL
            GROUP BY g.release_year
            ORDER BY g.release_year DESC
        """)
        
        years_breakdown = {}
        for row in cursor.fetchall():
            yr = row["release_year"]
            total_c = row["total_cached"] or 0
            total_s = row["total_swiped"] or 0
            pct = round((total_s / total_c * 100), 1) if total_c > 0 else 0.0
            years_breakdown[yr] = {
                "year": yr,
                "total_cached": total_c,
                "total_swiped": total_s,
                "played": row["played_count"] or 0,
                "skipped": row["skipped_count"] or 0,
                "backlog": row["backlog_count"] or 0,
                "percentage_reviewed": pct
            }

        return {
            "total_swipes": total_swipes,
            "status_counts": status_counts,
            "years": years_breakdown
        }

def get_all_swiped_records() -> List[Dict[str, Any]]:
    """Return all swiped games joined with metadata for export."""
    with get_connection() as conn:
        cursor = conn.execute("""
            SELECT 
                g.igdb_id,
                g.title,
                g.release_year,
                g.cover_url,
                g.summary,
                g.genres,
                g.platforms,
                g.total_rating_count,
                g.rating as igdb_rating,
                s.status,
                s.platform_played,
                s.hours_played,
                s.user_rating,
                s.created_at as swiped_at
            FROM user_swipes s
            JOIN cached_games g ON s.igdb_id = g.igdb_id
            ORDER BY s.created_at DESC
        """)
        return [dict(row) for row in cursor.fetchall()]

# =========================================================================
# User Settings Management
# =========================================================================
def get_setting(key: str, default: str = "") -> str:
    """Retrieve user setting by key."""
    with get_connection() as conn:
        cursor = conn.execute("SELECT value FROM user_settings WHERE key = ?", (key,))
        row = cursor.fetchone()
        return row[0] if row else default

def set_setting(key: str, value: str) -> None:
    """Upsert user setting key and value."""
    with get_connection() as conn:
        conn.execute("INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)", (key, str(value)))

def get_all_settings() -> Dict[str, Any]:
    """Retrieve all user settings as dictionary."""
    with get_connection() as conn:
        cursor = conn.execute("SELECT key, value FROM user_settings")
        settings = {}
        for row in cursor.fetchall():
            settings[row["key"]] = row["value"]
        
        # Ensure default rating_duration_seconds exists
        if "rating_duration_seconds" not in settings:
            settings["rating_duration_seconds"] = "10"
        return settings

# =========================================================================
# Catalog Explorer & In-Place Editing
# =========================================================================
def get_catalog_games(
    status: Optional[str] = None, 
    search: Optional[str] = None, 
    sort_by: str = "date_desc"
) -> List[Dict[str, Any]]:
    """
    Search and filter catalog of swiped games with flexible sorting:
    date_desc, date_asc, title_asc, year_desc, rating_desc, hours_desc
    """
    query = """
        SELECT 
            g.igdb_id,
            g.title,
            g.release_year,
            g.cover_url,
            g.summary,
            g.genres,
            g.platforms,
            g.total_rating_count,
            g.rating as igdb_rating,
            s.status,
            s.platform_played,
            s.hours_played,
            s.user_rating,
            s.created_at as swiped_at
        FROM user_swipes s
        JOIN cached_games g ON s.igdb_id = g.igdb_id
        WHERE 1=1
    """
    params = []

    if status and status.lower() != 'all':
        query += " AND s.status = ?"
        params.append(status.lower())

    if search and search.strip():
        query += " AND g.title LIKE ?"
        params.append(f"%{search.strip()}%")

    sort_map = {
        "date_desc": "s.created_at DESC",
        "date_asc": "s.created_at ASC",
        "title_asc": "g.title COLLATE NOCASE ASC",
        "year_desc": "g.release_year DESC, g.title ASC",
        "rating_desc": "s.user_rating DESC, g.title ASC",
        "hours_desc": "s.hours_played DESC, g.title ASC"
    }
    order_clause = sort_map.get(sort_by, "s.created_at DESC")
    query += f" ORDER BY {order_clause}"

    with get_connection() as conn:
        cursor = conn.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]

def update_swipe_item(
    igdb_id: int, 
    status: str, 
    platform_played: Optional[str] = None, 
    hours_played: Optional[int] = None, 
    user_rating: Optional[int] = None
) -> bool:
    """Update swipe record in-place."""
    if status not in ('played', 'skipped', 'backlog'):
        raise ValueError("Invalid status")

    with get_connection() as conn:
        cursor = conn.execute("""
            UPDATE user_swipes
            SET status = ?, platform_played = ?, hours_played = ?, user_rating = ?
            WHERE igdb_id = ?
        """, (status, platform_played, hours_played, user_rating, igdb_id))
        return cursor.rowcount > 0

def delete_swipe_item(igdb_id: int) -> bool:
    """Delete a swipe, restoring the game back to the unswiped pool."""
    with get_connection() as conn:
        conn.execute("DELETE FROM swipe_history WHERE igdb_id = ?", (igdb_id,))
        cursor = conn.execute("DELETE FROM user_swipes WHERE igdb_id = ?", (igdb_id,))
        return cursor.rowcount > 0

# =========================================================================
# Danger Zone Resets
# =========================================================================
def reset_year_swipes(year: int) -> int:
    """Delete swipes for a specific release year."""
    with get_connection() as conn:
        cursor = conn.execute("""
            DELETE FROM user_swipes 
            WHERE igdb_id IN (SELECT igdb_id FROM cached_games WHERE release_year = ?)
        """, (year,))
        deleted_count = cursor.rowcount
        conn.execute("""
            DELETE FROM swipe_history 
            WHERE igdb_id IN (SELECT igdb_id FROM cached_games WHERE release_year = ?)
        """, (year,))
        return deleted_count

def reset_all_swipes() -> int:
    """Clear all user swipes and swipe history, keeping cached games."""
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM user_swipes")
        deleted_count = cursor.rowcount
        conn.execute("DELETE FROM swipe_history")
        return deleted_count

def factory_reset() -> None:
    """Drop and re-initialize database with seed catalog."""
    with get_connection() as conn:
        conn.execute("DELETE FROM swipe_history")
        conn.execute("DELETE FROM user_swipes")
        conn.execute("DELETE FROM cached_games")
        conn.execute("DELETE FROM user_settings")
    init_db()
    seed_database_if_empty()

# Curated seed games spanning gaming history for immediate offline demo & testing
SEED_GAMES = [
    {
        "igdb_id": 1001,
        "title": "Super Mario Bros.",
        "release_year": 1985,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1vce.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/sc7w71.jpg"],
        "summary": "Super Mario Bros. is a platform game developed and published by Nintendo for the Famicom/NES. Players control Mario as he journeys through the Mushroom Kingdom to rescue Princess Toadstool.",
        "genres": "Platform, Adventure",
        "platforms": "NES, Famicom",
        "total_rating_count": 1420,
        "rating": 89.2
    },
    {
        "igdb_id": 1002,
        "title": "The Legend of Zelda",
        "release_year": 1986,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1vcf.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/sc7w72.jpg"],
        "summary": "The groundbreaking action-adventure game designed by Shigeru Miyamoto and Takashi Tezuka, where Link explores the fantasy land of Hyrule.",
        "genres": "Action, Adventure, RPG",
        "platforms": "NES, Famicom",
        "total_rating_count": 980,
        "rating": 88.0
    },
    {
        "igdb_id": 1003,
        "title": "Chrono Trigger",
        "release_year": 1995,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1vcg.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/sc7w73.jpg"],
        "summary": "Chrono Trigger is a role-playing video game developed and published by Square for the Super Nintendo Entertainment System, featuring time travel and multiple endings.",
        "genres": "Role-playing (RPG), Turn-based",
        "platforms": "Super Nintendo, PlayStation, Nintendo DS, PC",
        "total_rating_count": 1820,
        "rating": 95.1
    },
    {
        "igdb_id": 1004,
        "title": "Super Mario 64",
        "release_year": 1996,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1vch.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/sc7w74.jpg"],
        "summary": "The revolution in 3D platforming that defined analog camera control, free-roaming exploration, and acrobatic movement.",
        "genres": "Platform, 3D",
        "platforms": "Nintendo 64",
        "total_rating_count": 2100,
        "rating": 93.4
    },
    {
        "igdb_id": 1005,
        "title": "Half-Life",
        "release_year": 1998,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1vci.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/sc7w75.jpg"],
        "summary": "Valve's debut shooter cast players as theoretical physicist Gordon Freeman in the Black Mesa Research Facility, blending seamless narrative with FPS combat.",
        "genres": "Shooter, First-Person, Sci-Fi",
        "platforms": "PC (Windows), Mac, Linux, PlayStation 2",
        "total_rating_count": 2450,
        "rating": 94.6
    },
    {
        "igdb_id": 1006,
        "title": "The Legend of Zelda: Ocarina of Time",
        "release_year": 1998,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1vcj.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/sc7w76.jpg"],
        "summary": "Widely heralded as one of the greatest video games of all time, introducing target lock-on (Z-targeting) and contextual action buttons to 3D adventure games.",
        "genres": "Action, Adventure, Fantasy",
        "platforms": "Nintendo 64, GameCube, 3DS",
        "total_rating_count": 3100,
        "rating": 96.2
    },
    {
        "igdb_id": 1007,
        "title": "Halo: Combat Evolved",
        "release_year": 2001,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1vck.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/sc7w77.jpg"],
        "summary": "Master Chief's premier mission on an enigmatic ringworld established modern dual-analog console shooter controls and LAN multiplayer parties.",
        "genres": "Shooter, FPS, Sci-Fi",
        "platforms": "Xbox, PC (Windows), Mac",
        "total_rating_count": 2780,
        "rating": 91.8
    },
    {
        "igdb_id": 1008,
        "title": "Grand Theft Auto: San Andreas",
        "release_year": 2004,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1vcl.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/sc7w78.jpg"],
        "summary": "CJ returns to Los Santos in Rockstar Games' magnum opus of 2000s open-world crime, gang warfare, RPG mechanics, and radio soundtrack excellence.",
        "genres": "Action, Open World, Crime",
        "platforms": "PlayStation 2, Xbox, PC (Windows)",
        "total_rating_count": 4200,
        "rating": 93.9
    },
    {
        "igdb_id": 1009,
        "title": "Half-Life 2",
        "release_year": 2004,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1vcm.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/sc7w79.jpg"],
        "summary": "Equipped with the Gravity Gun and the Havok physics engine, Gordon Freeman joins Alyx Vance to spark revolution in City 17 against the Combine.",
        "genres": "Shooter, First-Person, Dystopian",
        "platforms": "PC (Windows), Xbox, Xbox 360, PlayStation 3",
        "total_rating_count": 3900,
        "rating": 95.8
    },
    {
        "igdb_id": 1010,
        "title": "World of Warcraft",
        "release_year": 2004,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1vcn.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/sc7w80.jpg"],
        "summary": "Blizzard Entertainment's cultural phenomenon MMORPG that united millions of players across Azeroth in raids, dungeons, and faction warfare.",
        "genres": "MMORPG, Role-playing (RPG), Fantasy",
        "platforms": "PC (Windows), Mac",
        "total_rating_count": 3400,
        "rating": 90.5
    },
    {
        "igdb_id": 1011,
        "title": "The Elder Scrolls V: Skyrim",
        "release_year": 2011,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1vco.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/sc7w81.jpg"],
        "summary": "As the Dragonborn, roam the vast, freezing province of Skyrim battling dragons, delving into barrows, and learning the Thu'um.",
        "genres": "Action RPG, Open World, Fantasy",
        "platforms": "PC, PS3, Xbox 360, PS4, Xbox One, Nintendo Switch, PS5",
        "total_rating_count": 5200,
        "rating": 92.5
    },
    {
        "igdb_id": 1012,
        "title": "The Witcher 3: Wild Hunt",
        "release_year": 2015,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1vcp.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/sc7w82.jpg"],
        "summary": "Geralt of Rivia searches for his adopted daughter Ciri while navigating murky morality, Slavic folklore, monster contracts, and the devastating Wild Hunt.",
        "genres": "Action RPG, Open World, Dark Fantasy",
        "platforms": "PC, PS4, Xbox One, Nintendo Switch, PS5, Xbox Series X/S",
        "total_rating_count": 6800,
        "rating": 96.0
    },
    {
        "igdb_id": 1013,
        "title": "Elden Ring",
        "release_year": 2022,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co4jni.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/scb1k2.jpg"],
        "summary": "FromSoftware and George R.R. Martin present the Lands Between, a monumental open-world Soulslike adventure of mystery, colossal bosses, and the quest to become Elden Lord.",
        "genres": "Action RPG, Open World, Soulslike",
        "platforms": "PC, PS4, PS5, Xbox One, Xbox Series X/S",
        "total_rating_count": 4800,
        "rating": 95.4
    },
    {
        "igdb_id": 1014,
        "title": "Baldur's Gate 3",
        "release_year": 2023,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co670h.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/scmbz1.jpg"],
        "summary": "Larian Studios' epic Dungeons & Dragons cRPG boasting unprecedented player agency, tactical turn-based combat, and rich companion storylines.",
        "genres": "Role-playing (RPG), Turn-based, Fantasy",
        "platforms": "PC, Mac, PS5, Xbox Series X/S",
        "total_rating_count": 3900,
        "rating": 96.5
    },
    {
        "igdb_id": 1015,
        "title": "Astro Bot",
        "release_year": 2024,
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co836t.jpg",
        "screenshots": ["https://images.igdb.com/igdb/image/upload/t_720p/scq1k2.jpg"],
        "summary": "Team Asobi's delightful 3D platformer celebrating 30 years of PlayStation history with creative mechanics, DualSense haptics, and joyous level design.",
        "genres": "Platform, 3D, Family",
        "platforms": "PlayStation 5",
        "total_rating_count": 1200,
        "rating": 94.2
    }
]

def seed_database_if_empty():
    """Seed the database with fallback games if it has zero cached games."""
    with get_connection() as conn:
        count = conn.execute("SELECT COUNT(*) FROM cached_games").fetchone()[0]
        if count == 0:
            upsert_cached_games(SEED_GAMES)
            logger.info("Seeded database with %d default games", len(SEED_GAMES))

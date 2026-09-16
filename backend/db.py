import sqlite3
import json
import logging
from contextlib import closing
from typing import Optional, List, Dict, Any
from .config import DATABASE_PATH

logger = logging.getLogger("xpdeck.db")

STATUSES = ("played", "skipped", "backlog")

# Bumped whenever _run_migrations gains a step. Stored in SQLite's own
# PRAGMA user_version slot, so no bookkeeping table is needed.
SCHEMA_VERSION = 1

# The columns the UI actually renders. Selecting these by name instead of g.*
# keeps the deck response lean and stops new columns leaking to the browser.
GAME_COLUMNS = """
    g.igdb_id, g.title, g.release_year, g.cover_url, g.screenshots,
    g.summary, g.genres, g.platforms, g.total_rating_count, g.rating
"""

# Swipe record joined with its game metadata - used by both catalog and export.
CATALOG_COLUMNS = GAME_COLUMNS + """,
    s.status, s.platform_played, s.hours_played, s.user_rating,
    s.created_at as swiped_at
"""


def get_connection() -> sqlite3.Connection:
    """Return a SQLite connection with Row factory and foreign keys enforced."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    # journal_mode is persisted in the database file, so it is set once in
    # init_db rather than on every connection. foreign_keys is per-connection.
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _row_to_game(row: sqlite3.Row) -> Dict[str, Any]:
    """Convert a cached_games row to a dict, decoding the screenshots JSON."""
    item = dict(row)
    if "screenshots" in item:
        try:
            item["screenshots"] = json.loads(item["screenshots"])
        except (TypeError, ValueError):
            item["screenshots"] = []
    return item


def init_db():
    """Create tables and indexes if absent, then run pending migrations."""
    with closing(get_connection()) as conn, conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS cached_games (
            igdb_id INTEGER PRIMARY KEY,
            title TEXT NOT NULL,
            release_year INTEGER,
            cover_url TEXT,
            screenshots TEXT,       -- JSON array of image URLs
            summary TEXT,
            genres TEXT,            -- Comma-separated
            platforms TEXT,         -- Comma-separated
            total_rating_count INTEGER DEFAULT 0,
            rating REAL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS user_swipes (
            igdb_id INTEGER PRIMARY KEY,
            status TEXT NOT NULL CHECK(status IN ('played', 'skipped', 'backlog')),
            platform_played TEXT,
            hours_played INTEGER,
            user_rating INTEGER,
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

        -- How many games IGDB lists for a release year, so the progress bar has
        -- a fixed denominator instead of one that grows as pages are fetched.
        CREATE TABLE IF NOT EXISTS year_totals (
            year INTEGER PRIMARY KEY,
            total INTEGER NOT NULL,
            fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_cached_year ON cached_games(release_year);
        CREATE INDEX IF NOT EXISTS idx_history_id ON swipe_history(history_id DESC);
        """)
        # INSERT OR IGNORE, so an existing database picks up new defaults
        # without overwriting whatever the user already chose.
        conn.executemany(
            "INSERT OR IGNORE INTO user_settings (key, value) VALUES (?, ?)",
            [("rating_duration_seconds", "10"), ("quick_tag_enabled", "1")]
        )
        _run_migrations(conn)
    logger.info("Database ready at %s", DATABASE_PATH)


def _run_migrations(conn: sqlite3.Connection) -> None:
    """Apply one-shot schema/data migrations, guarded by PRAGMA user_version."""
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version >= SCHEMA_VERSION:
        return

    if version < 1:
        _migrate_v1(conn)

    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def _migrate_v1(conn: sqlite3.Connection) -> None:
    """Purge the fabricated seed catalog and backfill image URLs.

    Gated on version < 1 specifically: ids 1001-1015 are inside the real IGDB
    id range, so this must never run a second time against a cache that has
    legitimately fetched games with those ids.
    """
    # The seed catalog shipped 15 games with invented igdb_ids (1001-1015) and
    # invented image ids. Those ids resolve to real IGDB artwork belonging to
    # *other* games, so cards showed the right title with the wrong cover.
    # Worse, upsert_cached_games would overwrite a seed row in place the first
    # time IGDB returned a colliding id, leaving user_swipes pointing at a
    # completely different game.
    purged = 0
    for table in ("user_swipes", "swipe_history", "cached_games"):
        purged += conn.execute(
            f"DELETE FROM {table} WHERE igdb_id BETWEEN 1001 AND 1015"
        ).rowcount

    # v1 - one-shot backfill of image URLs to 1080p (previously re-run on every
    # startup as two unconditional full scans).
    conn.execute(
        "UPDATE cached_games SET cover_url = replace(cover_url, 't_cover_big', 't_1080p') "
        "WHERE cover_url LIKE '%t_cover_big%'"
    )
    conn.execute(
        "UPDATE cached_games SET screenshots = replace(screenshots, 't_720p', 't_1080p') "
        "WHERE screenshots LIKE '%t_720p%'"
    )

    # v1 - raw_payload was written for every game and read by nothing.
    columns = {r[1] for r in conn.execute("PRAGMA table_info(cached_games)")}
    if "raw_payload" in columns:
        conn.execute("ALTER TABLE cached_games DROP COLUMN raw_payload")

    logger.warning("Migration v1: purged %d seed-catalog rows (igdb_id 1001-1015)", purged)


def upsert_cached_games(games: List[Dict[str, Any]]) -> int:
    """Insert or update a batch of games normalized by igdb_client."""
    if not games:
        return 0

    rows = [
        (
            g["igdb_id"],
            g["title"],
            g["release_year"],
            g["cover_url"],
            json.dumps(g["screenshots"]),
            g["summary"],
            g["genres"],
            g["platforms"],
            g["total_rating_count"],
            g["rating"],
        )
        for g in games
    ]

    with closing(get_connection()) as conn, conn:
        conn.executemany("""
            INSERT INTO cached_games (
                igdb_id, title, release_year, cover_url, screenshots,
                summary, genres, platforms, total_rating_count, rating
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(igdb_id) DO UPDATE SET
                title=excluded.title,
                release_year=excluded.release_year,
                cover_url=excluded.cover_url,
                screenshots=excluded.screenshots,
                summary=excluded.summary,
                genres=excluded.genres,
                platforms=excluded.platforms,
                total_rating_count=excluded.total_rating_count,
                rating=excluded.rating
        """, rows)
    return len(rows)


def get_unswiped_games(year: int, limit: int = 30) -> List[Dict[str, Any]]:
    """Return the next unswiped games for a year, most-reviewed first.

    No offset: swiped games are excluded by the LEFT JOIN, so the result set is
    self-paginating. An offset here would permanently skip unseen games as the
    unswiped set shrinks.
    """
    with closing(get_connection()) as conn:
        cursor = conn.execute(f"""
            SELECT {GAME_COLUMNS}
            FROM cached_games g
            LEFT JOIN user_swipes s ON g.igdb_id = s.igdb_id
            WHERE s.igdb_id IS NULL AND g.release_year = ?
            ORDER BY g.total_rating_count DESC, g.rating DESC
            LIMIT ?
        """, (year, limit))
        return [_row_to_game(row) for row in cursor.fetchall()]


def search_cached_games(query: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Title search over the local cache, used when IGDB is unavailable."""
    # escape LIKE wildcards so a search for "%" doesn't match everything
    pattern = "%" + query.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    with closing(get_connection()) as conn:
        cursor = conn.execute(f"""
            SELECT {GAME_COLUMNS}
            FROM cached_games g
            LEFT JOIN user_swipes s ON g.igdb_id = s.igdb_id
            WHERE s.igdb_id IS NULL AND g.title LIKE ? ESCAPE '\\'
            ORDER BY g.total_rating_count DESC
            LIMIT ?
        """, (pattern, limit))
        return [_row_to_game(row) for row in cursor.fetchall()]


def get_game_by_id(igdb_id: int) -> Optional[Dict[str, Any]]:
    """Fetch a single cached game by IGDB id."""
    with closing(get_connection()) as conn:
        row = conn.execute(
            f"SELECT {GAME_COLUMNS} FROM cached_games g WHERE g.igdb_id = ?", (igdb_id,)
        ).fetchone()
        return _row_to_game(row) if row else None


def game_exists(igdb_id: int) -> bool:
    """True if the game is in the local cache (guards the swipe foreign key)."""
    with closing(get_connection()) as conn:
        return conn.execute(
            "SELECT 1 FROM cached_games WHERE igdb_id = ?", (igdb_id,)
        ).fetchone() is not None


def record_swipe(
    igdb_id: int,
    status: str,
    platform_played: Optional[str] = None,
    hours_played: Optional[int] = None,
    user_rating: Optional[int] = None
) -> Dict[str, Any]:
    """Record or update a swipe and append it to the undo history."""
    with closing(get_connection()) as conn, conn:
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

        conn.execute(
            "INSERT INTO swipe_history (igdb_id, action) VALUES (?, ?)", (igdb_id, status)
        )

    return {
        "success": True,
        "igdb_id": igdb_id,
        "status": status,
        "platform_played": platform_played,
        "hours_played": hours_played,
        "user_rating": user_rating
    }


def undo_last_swipe() -> Optional[Dict[str, Any]]:
    """Revert the most recent swipe that still has a matching user_swipes row.

    History rows can outlive their swipe (a catalog unswipe deletes the swipe,
    and a re-swipe appends a second history row). Popping blindly would report
    success for a swipe that is already gone and hand the frontend a duplicate
    card, so stale history rows are discarded until one actually deletes.
    """
    with closing(get_connection()) as conn, conn:
        while True:
            row = conn.execute(
                "SELECT history_id, igdb_id, action FROM swipe_history ORDER BY history_id DESC LIMIT 1"
            ).fetchone()
            if not row:
                return None

            conn.execute("DELETE FROM swipe_history WHERE history_id = ?", (row["history_id"],))
            deleted = conn.execute(
                "DELETE FROM user_swipes WHERE igdb_id = ?", (row["igdb_id"],)
            ).rowcount
            if not deleted:
                continue  # stale history row, try the one before it

            game_row = conn.execute(
                f"SELECT {GAME_COLUMNS} FROM cached_games g WHERE g.igdb_id = ?", (row["igdb_id"],)
            ).fetchone()
            return {
                "restored_game": _row_to_game(game_row) if game_row else None,
                "undone_action": row["action"],
                "igdb_id": row["igdb_id"]
            }


def get_stats() -> Dict[str, Any]:
    """Return swipe totals by status plus a per-release-year breakdown."""
    with closing(get_connection()) as conn:
        counts = dict(conn.execute(
            "SELECT status, COUNT(*) FROM user_swipes GROUP BY status"
        ).fetchall())
        status_counts = {s: counts.get(s, 0) for s in STATUSES}

        cursor = conn.execute("""
            SELECT
                g.release_year AS year,
                COUNT(g.igdb_id) AS total_cached,
                COUNT(s.igdb_id) AS total_swiped,
                SUM(s.status = 'played') AS played,
                SUM(s.status = 'skipped') AS skipped,
                SUM(s.status = 'backlog') AS backlog,
                ROUND(100.0 * COUNT(s.igdb_id) / COUNT(g.igdb_id), 1) AS percentage_reviewed,
                (SELECT total FROM year_totals t WHERE t.year = g.release_year) AS total_available
            FROM cached_games g
            LEFT JOIN user_swipes s ON g.igdb_id = s.igdb_id
            WHERE g.release_year IS NOT NULL
            GROUP BY g.release_year
            ORDER BY g.release_year DESC
        """)
        years = {}
        for row in cursor.fetchall():
            entry = dict(row)
            # SUM over an empty group yields NULL
            for key in ("played", "skipped", "backlog"):
                entry[key] = entry[key] or 0
            years[entry["year"]] = entry

        return {
            "total_swipes": sum(status_counts.values()),
            "status_counts": status_counts,
            "years": years
        }


# =========================================================================
# User Settings
# =========================================================================
def set_setting(key: str, value: str) -> None:
    """Upsert a single user setting."""
    with closing(get_connection()) as conn, conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value) VALUES (?, ?)", (key, str(value))
        )


def get_all_settings() -> Dict[str, Any]:
    """Return every user setting as a dict."""
    with closing(get_connection()) as conn:
        return dict(conn.execute("SELECT key, value FROM user_settings").fetchall())


def get_year_total(year: int) -> Optional[int]:
    """Cached count of games IGDB lists for a release year, or None."""
    with closing(get_connection()) as conn:
        row = conn.execute("SELECT total FROM year_totals WHERE year = ?", (year,)).fetchone()
        return row[0] if row else None


def set_year_total(year: int, total: int) -> None:
    """Record the IGDB count for a year."""
    with closing(get_connection()) as conn, conn:
        conn.execute("""
            INSERT INTO year_totals (year, total, fetched_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(year) DO UPDATE SET total=excluded.total, fetched_at=CURRENT_TIMESTAMP
        """, (year, total))


# =========================================================================
# Catalog Explorer & Export
# =========================================================================
SORT_OPTIONS = {
    "date_desc": "s.created_at DESC",
    "date_asc": "s.created_at ASC",
    "title_asc": "g.title COLLATE NOCASE ASC",
    "year_desc": "g.release_year DESC, g.title ASC",
    "year_asc": "g.release_year ASC, g.title ASC",
    "rating_desc": "s.user_rating DESC, g.title ASC",
    "hours_desc": "s.hours_played DESC, g.title ASC"
}


def get_catalog_games(
    status: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "date_desc"
) -> List[Dict[str, Any]]:
    """Return swiped games, optionally filtered by status/title and sorted.

    Called with no arguments this is also the export query.
    """
    query = f"""
        SELECT {CATALOG_COLUMNS}
        FROM user_swipes s
        JOIN cached_games g ON s.igdb_id = g.igdb_id
        WHERE 1=1
    """
    params: List[Any] = []

    if status and status.lower() != 'all':
        query += " AND s.status = ?"
        params.append(status.lower())

    if search and search.strip():
        # escape LIKE wildcards so a search for "%" doesn't match everything
        query += " AND g.title LIKE ? ESCAPE '\\'"
        escaped = search.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        params.append(f"%{escaped}%")

    query += " ORDER BY " + SORT_OPTIONS.get(sort_by, SORT_OPTIONS["date_desc"])

    with closing(get_connection()) as conn:
        return [_row_to_game(row) for row in conn.execute(query, params).fetchall()]


def update_swipe_item(
    igdb_id: int,
    status: str,
    platform_played: Optional[str] = None,
    hours_played: Optional[int] = None,
    user_rating: Optional[int] = None
) -> bool:
    """Edit a swipe record in place. Returns False if no such record."""
    with closing(get_connection()) as conn, conn:
        return conn.execute("""
            UPDATE user_swipes
            SET status = ?, platform_played = ?, hours_played = ?, user_rating = ?
            WHERE igdb_id = ?
        """, (status, platform_played, hours_played, user_rating, igdb_id)).rowcount > 0


def delete_swipe_item(igdb_id: int) -> bool:
    """Delete a swipe, returning the game to the unswiped pool."""
    with closing(get_connection()) as conn, conn:
        conn.execute("DELETE FROM swipe_history WHERE igdb_id = ?", (igdb_id,))
        return conn.execute(
            "DELETE FROM user_swipes WHERE igdb_id = ?", (igdb_id,)
        ).rowcount > 0


# =========================================================================
# Danger Zone Resets
# =========================================================================
def reset_swipes(year: Optional[int] = None) -> int:
    """Delete swipes for one release year, or all of them when year is None."""
    where, params = "", ()
    if year is not None:
        where = " WHERE igdb_id IN (SELECT igdb_id FROM cached_games WHERE release_year = ?)"
        params = (year,)

    with closing(get_connection()) as conn, conn:
        deleted = conn.execute(f"DELETE FROM user_swipes{where}", params).rowcount
        conn.execute(f"DELETE FROM swipe_history{where}", params)
        return deleted


def factory_reset() -> None:
    """Wipe every table, keeping the schema."""
    with closing(get_connection()) as conn, conn:
        for table in ("swipe_history", "user_swipes", "cached_games", "user_settings"):
            conn.execute(f"DELETE FROM {table}")
    init_db()

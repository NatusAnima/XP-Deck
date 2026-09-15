import time
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
import httpx
from .config import TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, has_twitch_credentials

logger = logging.getLogger("xpdeck.igdb")

TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token"
IGDB_GAMES_URL = "https://api.igdb.com/v4/games"

class IGDBClient:
    def __init__(self):
        self._access_token: Optional[str] = None
        self._token_expires_at: float = 0.0

    async def get_valid_token(self) -> Optional[str]:
        """Fetch or return cached Twitch OAuth2 access token."""
        if not has_twitch_credentials():
            logger.warning("Twitch credentials not configured. Running in offline/cached mode.")
            return None

        now = time.time()
        # Return cached token if valid for at least 5 more minutes
        if self._access_token and now < (self._token_expires_at - 300):
            return self._access_token

        logger.info("Acquiring fresh Twitch OAuth2 access token...")
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    TWITCH_TOKEN_URL,
                    params={
                        "client_id": TWITCH_CLIENT_ID,
                        "client_secret": TWITCH_CLIENT_SECRET,
                        "grant_type": "client_credentials"
                    }
                )
                resp.raise_for_status()
                data = resp.json()
                self._access_token = data.get("access_token")
                expires_in = data.get("expires_in", 3600)
                self._token_expires_at = now + expires_in
                logger.info("Twitch OAuth token acquired successfully (valid for %d seconds)", expires_in)
                return self._access_token
        except Exception as e:
            logger.error("Failed to acquire Twitch OAuth token: %s", e)
            return None

    def _build_image_url(self, img_obj: Any, size: str = "t_cover_big") -> Optional[str]:
        """Convert IGDB image object to high-resolution HTTPS URL."""
        if not img_obj:
            return None
        
        if isinstance(img_obj, dict):
            image_id = img_obj.get("image_id")
            if image_id:
                return f"https://images.igdb.com/igdb/image/upload/{size}/{image_id}.jpg"
            url = img_obj.get("url")
            if url:
                url = url.replace("t_thumb", size)
                if url.startswith("//"):
                    url = f"https:{url}"
                return url
        elif isinstance(img_obj, str):
            url = img_obj.replace("t_thumb", size)
            if url.startswith("//"):
                url = f"https:{url}"
            return url
        return None

    def _normalize_game(self, raw: Dict[str, Any], year: int) -> Dict[str, Any]:
        """Transform raw IGDB response item into database-compatible dict."""
        igdb_id = raw.get("id")
        title = raw.get("name", "Untitled")
        
        # Calculate release year
        first_release = raw.get("first_release_date")
        release_year = year
        if first_release:
            try:
                release_year = datetime.fromtimestamp(first_release, tz=timezone.utc).year
            except Exception:
                release_year = year

        # Cover image
        cover_url = self._build_image_url(raw.get("cover"), size="t_cover_big")

        # Screenshots
        screenshots = []
        raw_screens = raw.get("screenshots", [])
        if isinstance(raw_screens, list):
            for s in raw_screens[:8]: # Grab up to 8 high-res screenshots
                s_url = self._build_image_url(s, size="t_720p")
                if s_url:
                    screenshots.append(s_url)

        summary = raw.get("summary", "") or ""
        
        # Genres
        genres_list = [g.get("name") for g in raw.get("genres", []) if g.get("name")]
        genres_str = ", ".join(genres_list)

        # Platforms
        platforms_list = [p.get("name") for p in raw.get("platforms", []) if p.get("name")]
        platforms_str = ", ".join(platforms_list)

        total_rating_count = raw.get("total_rating_count", 0) or 0
        rating = round(raw.get("rating", 0.0) or 0.0, 1)

        return {
            "igdb_id": igdb_id,
            "title": title,
            "release_year": release_year,
            "cover_url": cover_url,
            "screenshots": screenshots,
            "summary": summary,
            "genres": genres_str,
            "platforms": platforms_str,
            "total_rating_count": total_rating_count,
            "rating": rating,
            "raw_payload": raw
        }

    async def fetch_top_games_for_year(self, year: int, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """
        Query IGDB for top games released in a given year.
        Filters out shovelware using total_rating_count sorting and category filtering.
        Supports offset for continuous pagination.
        """
        token = await self.get_valid_token()
        if not token:
            logger.info("No Twitch token available; skipping remote IGDB fetch")
            return []

        # Calculate UTC Unix timestamps for year boundaries
        start_date = datetime(year, 1, 1, 0, 0, 0, tzinfo=timezone.utc)
        end_date = datetime(year, 12, 31, 23, 59, 59, tzinfo=timezone.utc)
        start_ts = int(start_date.timestamp())
        end_ts = int(end_date.timestamp())

        headers = {
            "Client-ID": TWITCH_CLIENT_ID,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json"
        }

        # Apicalypse query:
        # game_type = (0, 8, 9, 10) corresponds to Main Game, Remake, Remaster, Expanded Game
        # version_parent = null filters out specific minor editions
        query = f"""
        fields id, name, summary, total_rating_count, rating, first_release_date,
               cover.url, cover.image_id,
               screenshots.url, screenshots.image_id,
               genres.name,
               platforms.name, platforms.abbreviation;
        where first_release_date >= {start_ts} & first_release_date <= {end_ts}
              & (game_type = (0, 8, 9, 10) | game_type = null)
              & version_parent = null;
        sort total_rating_count desc;
        limit {limit};
        offset {offset};
        """.strip()

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(IGDB_GAMES_URL, headers=headers, content=query)
                resp.raise_for_status()
                games_raw = resp.json()
                logger.info("Fetched %d games from IGDB for year %d", len(games_raw), year)
                return [self._normalize_game(g, year) for g in games_raw]
        except Exception as e:
            logger.error("Error executing IGDB query for year %d: %s", year, e)
            return []

# Singleton instance
igdb_client = IGDBClient()

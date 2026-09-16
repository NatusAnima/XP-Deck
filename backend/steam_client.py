"""Steam Web API client: read a user's owned games and playtime.

Only two calls are needed - resolving a profile name to a SteamID64, and
listing owned games - so this stays a pair of functions rather than a class.
"""
import logging
import re
from typing import Dict, List, Optional, Tuple

import httpx

from . import config

logger = logging.getLogger("xpdeck.steam")

RESOLVE_URL = "https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/"
OWNED_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/"

_client = httpx.AsyncClient(timeout=30.0)

# A SteamID64 is 17 digits starting with 7656119.
STEAM_ID64 = re.compile(r"^\d{17}$")


async def close_client() -> None:
    """Close the shared HTTP client. Called on application shutdown."""
    await _client.aclose()


def _vanity_from(text: str) -> str:
    """Pull the profile name out of whatever the user pasted.

    Accepts a bare name, a /id/name URL, or a /profiles/<id64> URL.
    """
    text = text.strip().rstrip("/")
    match = re.search(r"steamcommunity\.com/(?:id|profiles)/([^/?#]+)", text)
    return match.group(1) if match else text


async def resolve_steam_id(api_key: str, profile: str) -> Tuple[Optional[str], Optional[str]]:
    """Turn a profile name, URL or SteamID64 into a SteamID64.

    Returns (steam_id, error_message); exactly one is set.
    """
    candidate = _vanity_from(profile)
    if STEAM_ID64.match(candidate):
        return candidate, None

    try:
        resp = await _client.get(RESOLVE_URL, params={"key": api_key, "vanityurl": candidate})
    except httpx.HTTPError:
        return None, "Could not reach Steam. Check your internet connection."

    if resp.status_code == 403:
        return None, "Steam rejected the API key."
    if resp.status_code != 200:
        return None, f"Steam returned HTTP {resp.status_code}."

    data = resp.json().get("response", {})
    if data.get("success") == 1 and data.get("steamid"):
        return data["steamid"], None
    return None, f'No Steam profile found for "{candidate}".'


async def fetch_owned_games(api_key: str, steam_id: str) -> Tuple[List[Dict], Optional[str]]:
    """List the account's games with playtime.

    Returns (games, error_message). Each game is {appid, name, minutes}.
    """
    try:
        resp = await _client.get(OWNED_URL, params={
            "key": api_key,
            "steamid": steam_id,
            "include_appinfo": 1,          # names, not just appids
            "include_played_free_games": 1,
        })
    except httpx.HTTPError:
        return [], "Could not reach Steam. Check your internet connection."

    if resp.status_code == 403:
        return [], "Steam rejected the API key."
    if resp.status_code != 200:
        return [], f"Steam returned HTTP {resp.status_code}."

    response = resp.json().get("response", {})
    # A private or friends-only "Game details" setting yields an empty object
    # rather than an error, which is the single most common thing to go wrong.
    if "games" not in response:
        return [], ("Steam returned no games. Set your profile's Game Details to "
                    "Public in Steam Privacy Settings, then try again.")

    games = [
        {
            "appid": g["appid"],
            "name": g.get("name") or f"Unknown app {g['appid']}",
            "minutes": g.get("playtime_forever", 0),
        }
        for g in response["games"]
    ]
    logger.info("Steam library for %s: %d games", steam_id, len(games))
    return games, None


async def verify_api_key(api_key: str) -> Optional[str]:
    """Check a Steam API key. Returns None when it works, else the reason."""
    try:
        # any well-formed request is enough; Valve's own test vanity always exists
        resp = await _client.get(RESOLVE_URL, params={"key": api_key, "vanityurl": "gabelogannewell"})
    except httpx.HTTPError:
        return "Could not reach Steam. Check your internet connection."

    if resp.status_code == 403:
        return "Steam rejected this API key."
    if resp.status_code != 200:
        return f"Steam returned HTTP {resp.status_code}."
    return None


def has_api_key() -> bool:
    return bool(config.STEAM_API_KEY)

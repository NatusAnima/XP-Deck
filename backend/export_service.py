import csv
import io
import json
from typing import List, Dict, Any

CLEAN_HEADER = [
    "Title", "Release Year", "Status", "Platform",
    "User Rating", "Hours Played", "IGDB Rating", "Genres", "Logged At"
]

# XP-Deck status -> Playnite completion status
PLAYNITE_STATUS = {
    "played": "Completed",
    "backlog": "Plan to Play",
    "skipped": "Abandoned"
}


def _csv(header: List[str], rows) -> str:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(header)
    writer.writerows(rows)
    return output.getvalue()


def export_clean_csv(records: List[Dict[str, Any]]) -> str:
    """Spreadsheet-friendly CSV of every logged game."""
    return _csv(CLEAN_HEADER, (
        [
            r.get("title", ""),
            r.get("release_year", "") or "",
            r.get("status", "").capitalize(),
            r.get("platform_played") or "",
            r.get("user_rating") or "",
            r.get("hours_played") or "",
            r.get("rating") or "",
            r.get("genres") or "",
            r.get("swiped_at") or ""
        ]
        for r in records
    ))


def export_json(records: List[Dict[str, Any]]) -> str:
    """Full structured dump, including game metadata."""
    return json.dumps(records, indent=2, ensure_ascii=False)


def export_playnite_csv(records: List[Dict[str, Any]]) -> str:
    """Playnite library import format. Score is 0-100, time played is seconds."""
    def row(r):
        rating = r.get("user_rating")
        hours = r.get("hours_played")
        # fall back to the game's first known platform when none was tagged
        platform = r.get("platform_played") or (r.get("platforms") or "PC").split(",")[0].strip()
        return [
            r.get("title", ""),
            platform,
            PLAYNITE_STATUS.get(r.get("status", ""), "Not Played"),
            rating * 10 if rating is not None else "",
            (hours or 0) * 3600
        ]

    return _csv(
        ["Name", "Platform", "Completion Status", "User Score", "Time Played"],
        (row(r) for r in records)
    )

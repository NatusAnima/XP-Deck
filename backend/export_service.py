import csv
import io
import json
from typing import List, Dict, Any

def export_clean_csv(records: List[Dict[str, Any]]) -> str:
    """
    Generate clean standard CSV:
    Title, Release Year, Status, Platform, Rating (1-10), Hours Played, Logged Date
    """
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Title", 
        "Release Year", 
        "Status", 
        "Platform", 
        "User Rating", 
        "Hours Played", 
        "IGDB Rating",
        "Genres",
        "Logged At"
    ])
    
    for r in records:
        writer.writerow([
            r.get("title", ""),
            r.get("release_year", ""),
            (r.get("status", "")).capitalize(),
            r.get("platform_played", "") or "",
            r.get("user_rating", "") or "",
            r.get("hours_played", "") or "",
            r.get("igdb_rating", "") or "",
            r.get("genres", "") or "",
            r.get("swiped_at", "") or ""
        ])
        
    return output.getvalue()

def export_json(records: List[Dict[str, Any]]) -> str:
    """Generate pretty-printed structured JSON export."""
    return json.dumps(records, indent=2, ensure_ascii=False)

def export_playnite_csv(records: List[Dict[str, Any]]) -> str:
    """
    Generate Playnite-compatible CSV format for seamless library import.
    Fields: Name, Platform, Completion Status, User Score, Time Played (seconds)
    """
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Name", "Platform", "Completion Status", "User Score", "Time Played"])
    
    status_mapping = {
        "played": "Completed",
        "backlog": "Plan to Play",
        "skipped": "Abandoned"
    }

    for r in records:
        status_raw = r.get("status", "")
        playnite_status = status_mapping.get(status_raw, "Not Played")
        
        # Playnite uses 0-100 scale for user score
        user_rating = r.get("user_rating")
        score = (user_rating * 10) if user_rating is not None else ""
        
        # Playnite expects time played in seconds
        hours = r.get("hours_played")
        time_played_seconds = (int(hours) * 3600) if hours else 0

        platform = r.get("platform_played") or (r.get("platforms", "").split(",")[0].strip() if r.get("platforms") else "PC")

        writer.writerow([
            r.get("title", ""),
            platform,
            playnite_status,
            score,
            time_played_seconds
        ])

    return output.getvalue()

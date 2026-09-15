import asyncio
import os
import sys

# Ensure project root is in sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.config import has_twitch_credentials
from backend.db import (
    init_db,
    seed_database_if_empty,
    get_unswiped_games,
    record_swipe,
    undo_last_swipe,
    get_stats,
    get_all_swiped_records,
    get_connection
)
from backend.igdb_client import igdb_client
from backend.export_service import export_clean_csv, export_json, export_playnite_csv

async def run_tests():
    print("=== Testing SQLite Database Initialization ===")
    init_db()
    seed_database_if_empty()
    
    with get_connection() as conn:
        count = conn.execute("SELECT COUNT(*) FROM cached_games").fetchone()[0]
        print(f"Total games in cached_games: {count}")
        assert count > 0, "Database should have cached games"

    print("\n=== Testing Unswiped Games Query ===")
    games_1998 = get_unswiped_games(1998)
    print(f"Unswiped games in 1998 (before IGDB fetch): {len(games_1998)}")

    print("\n=== Testing Live IGDB Client ===")
    print(f"Has Twitch credentials: {has_twitch_credentials()}")
    if has_twitch_credentials():
        top_2004 = await igdb_client.fetch_top_games_for_year(2004, limit=5)
        print(f"Fetched {len(top_2004)} games for 2004 from IGDB:")
        for g in top_2004:
            print(f"  - [{g['igdb_id']}] {g['title']} (Rating count: {g['total_rating_count']})")
        assert len(top_2004) > 0, "IGDB should return games for 2004"

    print("\n=== Testing Swipe & Undo Mechanics ===")
    test_id = 1005 # Half-Life (1998)
    swipe_res = record_swipe(test_id, "played", platform_played="PC", hours_played=40, user_rating=10)
    print("Recorded swipe:", swipe_res)
    assert swipe_res["success"] is True

    stats = get_stats()
    print("Stats after swipe:", stats["status_counts"])
    assert stats["status_counts"]["played"] >= 1

    undo_res = undo_last_swipe()
    print("Undone swipe:", undo_res["undone_action"], "for game:", undo_res["restored_game"]["title"])
    assert undo_res["igdb_id"] == test_id

    stats_after_undo = get_stats()
    print("Stats after undo:", stats_after_undo["status_counts"])
    assert stats_after_undo["status_counts"]["played"] == stats["status_counts"]["played"] - 1

    print("\n=== Testing Exports ===")
    # Re-record a swipe for export testing
    record_swipe(1008, "played", platform_played="PlayStation 2", hours_played=60, user_rating=10)
    record_swipe(1009, "backlog")
    
    records = get_all_swiped_records()
    print(f"Total swiped records: {len(records)}")
    
    csv_data = export_clean_csv(records)
    print("CSV sample:\n", "\n".join(csv_data.strip().split("\n")[:3]))
    assert "Grand Theft Auto: San Andreas" in csv_data
    
    json_data = export_json(records)
    assert "San Andreas" in json_data

    playnite_data = export_playnite_csv(records)
    print("Playnite CSV sample:\n", "\n".join(playnite_data.strip().split("\n")[:3]))
    assert "Completed" in playnite_data

    print("\n>>> ALL BACKEND TESTS PASSED SUCCESSFULLY! <<<")

if __name__ == "__main__":
    asyncio.run(run_tests())

# XP-Deck (Personal Video Game Archive & Swiper)

> A lightweight, self-hosted web application for rapidly tagging, sorting, and logging lifetime-played video games via a mobile-optimized card-swiping interface styled with a nostalgic **Windows XP (Luna)** aesthetic.

---

## Features

* **Windows XP (Luna) Design System:** Classic blue title bar gradients, beveled outset/inset frames, segmented green progress bars, retro menus, and status bar.
* **3D Card Flip Details:** Tap any card or press `Space`/`F` to flip it in 3D, revealing the full synopsis, a screenshot gallery, platforms, genres, and the IGDB rating.
* **Mobile Touch Gestures & Desktop Controls:**
  * **Swipe Right / `D` or `→`:** Mark as **Played** (opens a quick-tag popover for platform, hours & 1–10 rating).
  * **Swipe Left / `A` or `←`:** Mark as **Skipped** (never played).
  * **Swipe Up / `W` or `↑`:** Send to **Active Backlog** (want to play).
  * **`Ctrl+Z` / `U`:** **Undo** last swipe (restores the card to the deck).
* **Search by Title:** Find any game across every year without knowing its release date — results drop straight into the deck.
* **Deck Filters:** Swipe a single year, a decade, or all of gaming history. Narrow by genre, order by most-rated / highest-rated / newest / oldest, and set a minimum-ratings floor to keep obscure titles out. The filter persists between sessions.
* **Add Without Swiping:** An **Add a Game** dialog on both the deck and the catalog — search a title, then file it as Played, Backlog or Skipped in one click. Games already in your archive show their current status, so it doubles as a way to move them.
* **Manual Entries:** Homebrew, mods, fan translations or anything IGDB simply does not list can be added by hand. These get negative ids, so a later IGDB fetch can never overwrite them.
* **Steam Import:** Pull your Steam library in bulk, with playtime. Set a minimum-hours filter (skip everything under an hour, say), review exactly what matched, and confirm before anything is written. Games already logged are listed but unticked, so a re-import never quietly overwrites your own edits.
* **IGDB Integration & Anti-Shovelware Filtering:**
  * Connects directly to Twitch OAuth2 & IGDB API v4.
  * Filters low-effort titles via popularity ranking and category filtering (`game_type = 0, 8, 9, 10`).
  * Caches metadata locally in SQLite (`data/games.db`) and tops the deck up automatically as you swipe.
* **Multi-Format Export Center:**
  * **Clean CSV:** Title, Release Year, Status, Platform, Rating, Hours Played, Logged Date.
  * **Playnite-Compatible CSV:** Directly importable into Playnite (`Name, Platform, Completion Status, User Score, Time Played`).
  * **Structured JSON:** Full dump including game metadata and swipe history.
* **Retro Audio:** Windows XP style clicks, chimes, and swipe whooshes synthesized via the Web Audio API (toggleable).
* **LAN & Tailscale Friendly:** Bind to `0.0.0.0` to swipe from your phone or tablet anywhere on your home network.

---

## Getting Started

### The easy way

1. **[Download XP-Deck](https://github.com/NatusAnima/XP-Deck/archive/refs/heads/main.zip)** and unzip it anywhere you like.
2. Double-click **`Start XP-Deck.bat`** (Windows) or **`start-xp-deck.sh`** (macOS/Linux).
3. That's it. The first run sets itself up, then your browser opens automatically.

XP-Deck will walk you through connecting to the game database on first launch —
it's free, takes about two minutes, and the app explains every step on screen.

> **No Python?** The launcher notices, opens the download page for you, and tells
> you what to click. Tick **"Add python.exe to PATH"** during that install, then
> double-click the launcher again.

Leave the black window open while you use XP-Deck; closing it stops the app.

### What the setup asks for

Game covers and descriptions come from **IGDB**, which is owned by Twitch — so
Twitch issues the keys. They are free and need no payment details. The app shows
you the six steps, but for reference:

1. Go to [dev.twitch.tv/console/apps/create](https://dev.twitch.tv/console/apps/create) and sign in.
2. **Name:** anything (`My XP-Deck` works).
3. **OAuth Redirect URL:** `http://localhost`
4. **Category:** Application Integration → **Create**.
5. Click **Manage** on your new app → **New Secret**.
6. Paste the **Client ID** and **Client Secret** into XP-Deck.

They are stored in a plain file called `.env` beside the app, are never sent
anywhere except Twitch, and you can change them later under
**Options → IGDB Credentials**.

### Importing your Steam library (optional)

**File → Import from Steam**, or the **Import Steam** button in the catalog.

You will need a Steam Web API key — free and instant from
[steamcommunity.com/dev/apikey](https://steamcommunity.com/dev/apikey) (enter
any domain, `localhost` works). The app verifies and stores it once.

Then enter your profile name, SteamID64 or profile URL, choose a minimum-hours
filter, and scan. Nothing is written until you review the list and press
Import.

> Steam only reports your games if the profile's **Game details** privacy
> setting is Public. If the scan comes back empty, that is almost always why.

---

## Running it manually

If you would rather not use the launcher:

```bash
git clone https://github.com/NatusAnima/XP-Deck.git
cd XP-Deck
pip install -r requirements.txt
python -m backend
```

`python -m backend` reads `HOST` and `PORT` from `.env` (defaults: `0.0.0.0:8000`).
For auto-reload while developing:

```bash
uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
```

> `python backend/app.py` does **not** work: `app.py` uses relative imports, so
> running it as a script fails on the first import. Use one of the commands above.

Then open <http://localhost:8000>. To use it from your phone, open
**View → Connect Phone (LAN)** and scan the QR code.

---

## Desktop Shortcuts

| Key | Action |
| --- | --- |
| `D` or `→` | Mark as **Played** |
| `A` or `←` | Mark as **Skipped** |
| `W` or `↑` | Add to **Active Backlog** |
| `Space` / `F` | **Flip Card** (synopsis & screenshot gallery) |
| `Ctrl+Z` or `U` | **Undo** last swipe |
| `1`–`9`, `0` | Select a rating during quick-tag (`0` = 10) |
| `Escape` | Cancel the quick-tag, or close a dialog |

### A note on "Highest rated"

IGDB lets anyone rate anything, so sorting purely by score surfaces unknown games
with five perfect votes. Pair **Highest rated** with a **minimum ratings** floor —
200 or so — and you get the games people actually agree are good. The floor also
makes the progress bar meaningful: *all time* is ~233,000 games, but *all time,
200+ ratings* is under a thousand.

Shortcuts stand down while a text field is focused, and `Space`/`Enter` always
activate a focused button rather than flipping the card.

---

## Directory Structure

```text
xp-deck/
├── Start XP-Deck.bat       # double-click launcher (Windows)
├── start-xp-deck.sh        # double-click launcher (macOS / Linux)
├── backend/
│   ├── __main__.py         # `python -m backend` entry point
│   ├── app.py              # FastAPI routes and static mounting
│   ├── config.py           # Environment variable loader (.env)
│   ├── db.py               # SQLite schema, migrations, queries
│   ├── igdb_client.py      # Twitch token handling & Apicalypse queries
│   ├── steam_client.py     # Steam Web API: owned games and playtime
│   └── export_service.py   # Clean CSV, JSON, and Playnite export
├── static/
│   ├── index.html          # Swiper frame + <template> definitions
│   ├── catalog.html        # Windows Explorer style archive browser
│   ├── css/
│   │   ├── xp-luna.css     # Theme tokens, controls, dialogs, responsive rules
│   │   ├── swiper.css      # Card deck, 3D flip, gestures, quick-tag
│   │   └── catalog.css     # Explorer chrome for the archive page
│   └── js/
│       ├── shared.js       # $, clone(), gameLinks() — used by both pages
│       ├── add-game.js     # Add a Game dialog (shared by both pages)
│       ├── steam-import.js # Steam library import (shared by both pages)
│       ├── api.js          # Backend fetch client
│       ├── gestures.js     # Pointer swipe physics
│       ├── shortcuts.js    # Keyboard controls
│       ├── app.js          # Deck state, rendering, controls
│       └── catalog.js      # Archive browser
├── data/
│   └── games.db            # Auto-generated SQLite database (gitignored)
├── .env.example            # Environment template
├── requirements.txt        # Python dependencies
└── README.md
```

---

## Database Schema

Schema and data migrations run automatically at startup, gated on SQLite's
`PRAGMA user_version`, so each one applies exactly once.

```sql
CREATE TABLE cached_games (
    igdb_id INTEGER PRIMARY KEY,   -- a real IGDB id, or negative for a manual entry
    title TEXT NOT NULL,
    release_year INTEGER,          -- NULL when IGDB has no release date
    cover_url TEXT,
    screenshots TEXT,              -- JSON array of image URLs
    summary TEXT,
    genres TEXT,                   -- comma separated
    platforms TEXT,                -- comma separated
    total_rating_count INTEGER DEFAULT 0,
    rating REAL DEFAULT 0
);

CREATE TABLE user_swipes (
    igdb_id INTEGER PRIMARY KEY,
    status TEXT NOT NULL CHECK(status IN ('played', 'skipped', 'backlog')),
    platform_played TEXT,
    hours_played INTEGER,
    user_rating INTEGER,           -- 1-10
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(igdb_id) REFERENCES cached_games(igdb_id)
);

CREATE TABLE swipe_history (       -- powers Undo
    history_id INTEGER PRIMARY KEY AUTOINCREMENT,
    igdb_id INTEGER,
    action TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_settings (       -- key/value, e.g. rating_duration_seconds
    key TEXT PRIMARY KEY,
    value TEXT
);
```

---

## Notes

* XP-Deck has **no authentication** and its reset endpoints are destructive. Keep it
  on your LAN or a Tailscale network, not the public internet.
* Your archive lives entirely in `data/games.db` — copy that file to back it up, or
  use the Export Center.

---

## License

MIT License. Created with nostalgic appreciation for Windows XP and video game history.

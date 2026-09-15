# XP-Deck (Personal Video Game Archive & Swiper)

> A lightweight, self-hosted web application for rapidly tagging, sorting, and logging lifetime-played video games via a mobile-optimized card-swiping interface styled with a nostalgic **Windows XP (Luna)** aesthetic.

---

## 🎮 Features

* **Windows XP (Luna) Design System:** Classic blue title bar gradients, beveled outset/inset frames, segmented green progress bars, retro menus, and status bar.
* **3D Card Flip Details:** Tap any card or press `Space`/`F` to flip it in 3D, revealing full game synopses, high-res screenshots, platforms, genres, and IGDB ratings.
* **Mobile Touch Gestures & Desktop Controls:**
  * **Swipe Right / `D` or `→`:** Mark as **Played** (triggers a 2-second quick-tag popover for platform & 1–10 rating).
  * **Swipe Left / `A` or `←`:** Mark as **Skipped** (never played).
  * **Swipe Up / `W` or `↑`:** Send to **Active Backlog** (want to play).
  * **`Ctrl+Z` / `U`:** **Undo** last swipe (reverts database row and restores card to the deck).
* **Smart IGDB Caching & Anti-Shovelware Filtering:**
  * Connects directly to Twitch OAuth2 & IGDB API v4.
  * Filters out low-effort titles and shovelware via popularity ranking and category filtering (`game_type = 0, 8, 9, 10`).
  * Caches metadata locally in SQLite (`data/games.db`).
  * Built-in curated offline seed catalog ensures immediate out-of-the-box operation.
* **Multi-Format Export Center:**
  * **Clean CSV:** Title, Release Year, Status, Platform, Rating, Hours Played, Logged Date.
  * **Playnite-Compatible CSV:** Directly importable into your Playnite game library (`Name, Platform, Completion Status, User Score, Time Played`).
  * **Structured JSON:** Full JSON dump including game metadata and swipe history.
* **Authentic Retro Audio:** Windows XP navigation clicks, alert chimes, and swipe whooshes synthesized natively via Web Audio API (toggleable in menu and status bar).
* **LAN & Tailscale Friendly:** Run on `0.0.0.0:8000` to swipe smoothly on your smartphone or tablet from anywhere on your home network.

---

## 🚀 Quick Start

### 1. Prerequisites
* Python 3.10 or higher
* Git

### 2. Installation
Clone or download the repository:
```bash
git clone https://github.com/NatusAnima/xp-deck.git
cd xp-deck
```

Install backend dependencies:
```bash
pip install -r requirements.txt
```

### 3. Configure Credentials
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Edit `.env` with your Twitch Developer credentials:
```env
TWITCH_CLIENT_ID=your_twitch_client_id_here
TWITCH_CLIENT_SECRET=your_twitch_client_secret_here
HOST=0.0.0.0
PORT=8000
```
*(Get free credentials in 2 minutes at [dev.twitch.tv/console](https://dev.twitch.tv/console).)*

### 4. Run XP-Deck
```bash
python backend/app.py
```
Or with Uvicorn directly:
```bash
uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
```

Open your browser and navigate to:
```
http://localhost:8000
```
On mobile devices on the same Wi-Fi network, navigate to `http://<your-computer-ip>:8000`.

---

## ⌨️ Desktop Shortcuts

| Key | Action |
| --- | --- |
| `D` or `→` | Mark as **Played** |
| `A` or `←` | Mark as **Skipped** |
| `W` or `↑` | Add to **Active Backlog** |
| `Space` / `F` / `Enter` | **Flip Card** (view synopsis & screenshot gallery) |
| `Ctrl+Z` or `U` | **Undo** last swipe |
| `1` – `9` | Select rating during quick-tag popover |
| `Escape` | Close dialogs and popovers |

---

## 📁 Directory Structure

```text
xp-deck/
├── backend/
│   ├── app.py              # FastAPI server, routing, static mounting
│   ├── config.py           # Environment variable loader (.env)
│   ├── db.py               # SQLite schema setup, caching, swiping, undos
│   ├── igdb_client.py      # Twitch token manager & Apicalypse query builder
│   ├── export_service.py   # Clean CSV, JSON, and Playnite export logic
│   └── test_backend.py     # Backend test verification script
├── static/
│   ├── index.html          # Main application frame
│   ├── css/
│   │   ├── xp-luna.css     # Windows XP theme tokens, buttons, bevels, dialogs
│   │   └── swiper.css      # Card deck styling, swipe transforms, mobile layout
│   └── js/
│       ├── api.js          # Backend fetch client
│       ├── gestures.js     # Touch & mouse pointer tracking (swipe physics)
│       ├── shortcuts.js    # Desktop keyboard listeners (WASD / Arrows)
│       └── app.js          # State management, card rendering, QoL controls
├── data/
│   └── games.db            # Auto-generated SQLite database (gitignored)
├── .env.example            # Environment template
├── .gitignore              # Ignores .env and runtime databases
├── requirements.txt        # Python dependencies
└── README.md               # Documentation
```

---

## 💾 Database Schema

```sql
CREATE TABLE IF NOT EXISTS cached_games (
    igdb_id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    release_year INTEGER,
    cover_url TEXT,
    screenshots TEXT,
    summary TEXT,
    genres TEXT,
    platforms TEXT,
    total_rating_count INTEGER,
    rating REAL,
    raw_payload TEXT
);

CREATE TABLE IF NOT EXISTS user_swipes (
    igdb_id INTEGER PRIMARY KEY,
    status TEXT CHECK(status IN ('played', 'skipped', 'backlog')),
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
```

---

## 📄 License
MIT License. Created with nostalgic appreciation for Windows XP and video game history.

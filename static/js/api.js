/**
 * API.JS: Lightweight REST client for XP-Deck backend endpoints
 */

const API = {
  async getDeck(year, limit = 30) {
    const res = await fetch(`/api/deck?year=${encodeURIComponent(year)}&limit=${encodeURIComponent(limit)}`);
    if (!res.ok) throw new Error(`Deck fetch failed: ${res.statusText}`);
    return await res.json();
  },

  async recordSwipe(igdbId, status, platformPlayed = null, hoursPlayed = null, userRating = null) {
    const payload = {
      igdb_id: Number(igdbId),
      status,
      platform_played: platformPlayed,
      hours_played: hoursPlayed ? Number(hoursPlayed) : null,
      user_rating: userRating ? Number(userRating) : null
    };

    const res = await fetch('/api/swipe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`Swipe submission failed: ${res.statusText}`);
    return await res.json();
  },

  async undoSwipe() {
    const res = await fetch('/api/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    if (!res.ok) throw new Error(`Undo failed: ${res.statusText}`);
    return await res.json();
  },

  async getStats() {
    const res = await fetch('/api/stats');
    if (!res.ok) throw new Error(`Stats fetch failed: ${res.statusText}`);
    return await res.json();
  },

  async getStatus() {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error(`Status check failed: ${res.statusText}`);
    return await res.json();
  }
};

window.API = API;

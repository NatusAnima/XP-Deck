/**
 * API.JS: Lightweight REST client for XP-Deck backend endpoints
 */

const API = {
  async getDeck(year, limit = 30, offset = 0) {
    const res = await fetch(`/api/deck?year=${encodeURIComponent(year)}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`);
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
  },

  async getSettings() {
    const res = await fetch('/api/settings');
    if (!res.ok) throw new Error(`Failed to load settings: ${res.statusText}`);
    return await res.json();
  },

  async updateSettings(ratingDurationSeconds) {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating_duration_seconds: Number(ratingDurationSeconds) })
    });
    if (!res.ok) throw new Error(`Failed to update settings: ${res.statusText}`);
    return await res.json();
  },

  async getCatalog(status = 'all', search = '', sort = 'date_desc') {
    const params = new URLSearchParams();
    if (status && status !== 'all') params.set('status', status);
    if (search && search.trim()) params.set('search', search.trim());
    if (sort) params.set('sort', sort);

    const res = await fetch(`/api/catalog?${params.toString()}`);
    if (!res.ok) throw new Error(`Catalog fetch failed: ${res.statusText}`);
    return await res.json();
  },

  async updateCatalogItem(igdbId, data) {
    const res = await fetch(`/api/catalog/${encodeURIComponent(igdbId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`Failed to update catalog item: ${res.statusText}`);
    return await res.json();
  },

  async deleteCatalogItem(igdbId) {
    const res = await fetch(`/api/catalog/${encodeURIComponent(igdbId)}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error(`Failed to delete swipe: ${res.statusText}`);
    return await res.json();
  },

  async resetData(scope, year = null) {
    const res = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scope, year })
    });
    if (!res.ok) throw new Error(`Reset failed: ${res.statusText}`);
    return await res.json();
  },

  async getNetworkInfo() {
    const res = await fetch('/api/network-info');
    if (!res.ok) throw new Error(`Failed to get network info: ${res.statusText}`);
    return await res.json();
  }
};

window.API = API;

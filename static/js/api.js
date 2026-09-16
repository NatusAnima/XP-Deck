/**
 * API.JS: REST client for the XP-Deck backend.
 */

async function request(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    // surface the backend's own message when it sent one
    const detail = await res.json().then(d => d.detail).catch(() => null);
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return res.json();
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const API = {
  getDeck(year, limit = 30, igdbOffset = 0) {
    const params = new URLSearchParams({ year, limit, igdb_offset: igdbOffset });
    return request(`/api/deck?${params}`);
  },

  searchGames(query) {
    return request(`/api/search?${new URLSearchParams({ q: query })}`);
  },

  recordSwipe(igdbId, status, platformPlayed = null, hoursPlayed = null, userRating = null) {
    return request('/api/swipe', json('POST', {
      igdb_id: Number(igdbId),
      status,
      platform_played: platformPlayed || null,
      hours_played: hoursPlayed ?? null,
      user_rating: userRating ?? null
    }));
  },

  undoSwipe() {
    return request('/api/undo', { method: 'POST' });
  },

  getStats() {
    return request('/api/stats');
  },

  getSettings() {
    return request('/api/settings');
  },

  updateSettings(ratingDurationSeconds) {
    return request('/api/settings', json('POST', {
      rating_duration_seconds: Number(ratingDurationSeconds)
    }));
  },

  getCatalog(status = 'all', search = '', sort = 'date_desc') {
    const params = new URLSearchParams({ sort });
    if (status && status !== 'all') params.set('status', status);
    if (search.trim()) params.set('search', search.trim());
    return request(`/api/catalog?${params}`);
  },

  updateCatalogItem(igdbId, data) {
    return request(`/api/catalog/${igdbId}`, json('PUT', data));
  },

  deleteCatalogItem(igdbId) {
    return request(`/api/catalog/${igdbId}`, { method: 'DELETE' });
  },

  resetData(scope, year = null) {
    return request('/api/reset', json('POST', { scope, year }));
  },

  getNetworkInfo() {
    return request('/api/network-info');
  },

  getSetupStatus() {
    return request('/api/setup');
  },

  saveSetup(clientId, clientSecret) {
    return request('/api/setup', json('POST', {
      client_id: clientId,
      client_secret: clientSecret
    }));
  }
};

window.API = API;

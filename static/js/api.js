/**
 * API.JS: REST client for the XP-Deck backend.
 */

/** Turn FastAPI's `detail` into something worth showing a person. */
function describeError(detail, res) {
  if (typeof detail === 'string') return detail;
  // 422 validation errors come back as [{loc, msg, type}, ...]
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map(d => {
        const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : null;
        return field ? `${field}: ${d.msg}` : d.msg;
      })
      .join('; ');
  }
  return `${res.status} ${res.statusText}`;
}

async function request(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    // surface the backend's own message when it sent one
    const detail = await res.json().then(d => d.detail).catch(() => null);
    throw new Error(describeError(detail, res));
  }
  return res.json();
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body)
});

const API = {
  getDeck(filter, limit = 30, igdbOffset = 0) {
    const params = new URLSearchParams({
      limit, igdb_offset: igdbOffset,
      sort: filter.sort || 'popular',
      min_ratings: filter.minRatings || 0
    });
    if (filter.yearFrom != null) params.set('year_from', filter.yearFrom);
    if (filter.yearTo != null) params.set('year_to', filter.yearTo);
    if (filter.genre) params.set('genre', filter.genre);
    return request(`/api/deck?${params}`);
  },

  getGenres() {
    return request('/api/genres');
  },

  searchGames(query, includeLogged = false) {
    const params = new URLSearchParams({ q: query });
    if (includeLogged) params.set('include_logged', 'true');
    return request(`/api/search?${params}`);
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

  updateSettings(ratingDurationSeconds, quickTagEnabled) {
    return request('/api/settings', json('POST', {
      rating_duration_seconds: Number(ratingDurationSeconds),
      quick_tag_enabled: Boolean(quickTagEnabled)
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

  addManualGame(data) {
    return request('/api/games/manual', json('POST', data));
  },

  getSteamStatus() {
    return request('/api/steam');
  },

  saveSteamKey(apiKey) {
    return request('/api/steam/key', json('POST', { api_key: apiKey }));
  },

  scanSteamLibrary(profile, minHours) {
    return request('/api/steam/scan', json('POST', { profile, min_hours: minHours }));
  },

  importSteamGames(games, status) {
    return request('/api/steam/import', json('POST', { games, status }));
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

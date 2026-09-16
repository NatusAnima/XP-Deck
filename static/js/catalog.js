/**
 * CATALOG.JS: Windows Explorer style browser for the logged game archive.
 *
 * Rows are built from a <template> with textContent, so titles coming back
 * from IGDB and platform names typed by the user are never parsed as markup.
 * $, clone, gameLinks and hideOnError come from shared.js.
 */

const SEARCH_DEBOUNCE_MS = 250;

class CatalogExplorer {
  constructor() {
    this.status = 'all';
    this.search = '';
    this.sort = 'date_desc';
    this.games = [];
    this.editingId = null;
    this.searchTimer = null;
    // a slow response must not overwrite a newer one
    this.requestId = 0;

    this.init();
  }

  init() {
    document.querySelectorAll('.task-link[data-status]').forEach(link => {
      link.addEventListener('click', () => {
        document.querySelectorAll('.task-link[data-status]')
          .forEach(l => l.classList.remove('active'));
        link.classList.add('active');
        this.status = link.dataset.status;
        this.load();
      });
      link.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); link.click(); }
      });
    });

    $('catalog-search').addEventListener('input', (e) => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => {
        this.search = e.target.value.trim();
        this.load();
      }, SEARCH_DEBOUNCE_MS);
    });

    $('catalog-sort').addEventListener('change', (e) => {
      this.sort = e.target.value;
      this.load();
    });

    $('btn-refresh').addEventListener('click', () => this.load());

    // one delegated listener for every row action
    $('catalog-tbody').addEventListener('click', (e) => {
      const button = e.target.closest('button[data-action]');
      if (!button) return;
      const id = Number(button.closest('tr').dataset.id);
      this[button.dataset.action](id);
    });

    this.load();
  }

  async load() {
    const ticket = ++this.requestId;
    try {
      const [catalog, stats] = await Promise.all([
        API.getCatalog(this.status, this.search, this.sort),
        API.getStats()
      ]);
      if (ticket !== this.requestId) return;   // a newer request already landed

      this.games = catalog.games;
      this.render();
      this.renderCounts(stats);
    } catch (err) {
      if (ticket !== this.requestId) return;
      this.showMessage(`Error loading archive: ${err.message}`, true);
    }
  }

  renderCounts(stats) {
    const counts = stats.status_counts || {};
    const total = stats.total_swipes || 0;
    const values = {
      'count-all': total,
      'count-played': counts.played || 0,
      'count-backlog': counts.backlog || 0,
      'count-skipped': counts.skipped || 0,
      'info-total': total,
      'info-played': counts.played || 0,
      'info-backlog': counts.backlog || 0,
      'info-skipped': counts.skipped || 0
    };
    for (const [id, value] of Object.entries(values)) {
      $(id).textContent = value;
    }
    $('status-left').textContent =
      `${this.games.length} objects displayed (${total} total in archive)`;
  }

  showMessage(text, isError = false) {
    const { frag, r } = clone('tpl-empty-row');
    r.message.textContent = text;
    r.message.classList.toggle('error-text', isError);
    $('catalog-tbody').replaceChildren(frag);
  }

  render() {
    if (!this.games.length) {
      this.showMessage(this.search
        ? `No games match "${this.search}".`
        : 'No games in this view yet. Swipe some titles in the Deck to build your archive.');
      return;
    }

    const rows = document.createDocumentFragment();
    this.games.forEach(game => {
      rows.appendChild(this.buildRow(game));
      if (this.editingId === game.igdb_id) rows.appendChild(this.buildEditRow(game));
    });
    $('catalog-tbody').replaceChildren(rows);
  }

  buildRow(game) {
    const { frag, r } = clone('tpl-catalog-row');
    frag.firstElementChild.dataset.id = game.igdb_id;

    r.cover.src = game.cover_url || '';
    r.cover.alt = '';
    hideOnError(r.cover);

    r.title.textContent = game.title;
    r.meta.textContent = `${game.genres || 'Video Game'} • IGDB: ★ ${game.rating || 'Unrated'}`;
    r.year.textContent = game.release_year || '—';

    r.status.textContent = game.status;
    r.status.classList.add(game.status);

    r.rating.textContent = game.user_rating ? `★ ${game.user_rating}/10` : '—';
    r.rating.classList.toggle('rated', Boolean(game.user_rating));
    r.hours.textContent = game.hours_played ? `${game.hours_played} hrs` : '—';
    r.platform.textContent = game.platform_played || '—';

    const links = gameLinks(game.title);
    r.steam.href = links.steam;
    r.gog.href = links.gog;
    r.google.href = links.google;

    return frag;
  }

  buildEditRow(game) {
    const { frag, r } = clone('tpl-catalog-edit');
    r.status.value = game.status;
    r.rating.value = game.user_rating ?? '';
    r.hours.value = game.hours_played ?? '';
    r.platform.value = game.platform_played ?? '';

    r.save.addEventListener('click', () => this.saveEdit(game.igdb_id, {
      status: r.status.value,
      user_rating: r.rating.value ? Number(r.rating.value) : null,
      hours_played: r.hours.value ? Number(r.hours.value) : null,
      platform_played: r.platform.value.trim() || null
    }));
    r.cancel.addEventListener('click', () => this.cancelEdit());

    return frag;
  }

  edit(igdbId) {
    this.editingId = this.editingId === igdbId ? null : igdbId;
    this.render();
  }

  cancelEdit() {
    this.editingId = null;
    this.render();
  }

  async saveEdit(igdbId, payload) {
    try {
      await API.updateCatalogItem(igdbId, payload);
      this.editingId = null;
      await this.load();
    } catch (err) {
      this.showMessage(`Failed to save: ${err.message}`, true);
    }
  }

  async unswipe(igdbId) {
    const game = this.games.find(g => g.igdb_id === igdbId);
    if (!game) return;
    if (!confirm(`Remove "${game.title}" from your archive and return it to the deck?`)) return;

    try {
      await API.deleteCatalogItem(igdbId);
      await this.load();
    } catch (err) {
      this.showMessage(`Failed to unswipe: ${err.message}`, true);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.catalogApp = new CatalogExplorer();
});

/**
 * ADD-GAME.JS: the "Add a Game" dialog, shared by the deck and the catalog.
 *
 * It injects its own markup so both pages get the same dialog from one source
 * instead of duplicating fifty lines of HTML twice. Every string that comes
 * from IGDB or the user is set with textContent, never parsed as markup.
 */

const ADD_GAME_MARKUP = `
<div class="xp-modal-overlay" id="modal-add" role="dialog" aria-labelledby="modal-add-title" aria-modal="true">
  <div class="xp-dialog dialog-wide">
    <div class="xp-title-bar">
      <div class="xp-title-content">
        <svg class="xp-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#FFF" d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>
        <span id="modal-add-title">Add a Game to Your Archive</span>
      </div>
      <button class="xp-win-btn close" data-add-close aria-label="Close">&#10005;</button>
    </div>

    <div class="xp-dialog-body">
      <form class="add-search-row" id="add-search-form" role="search">
        <label for="add-search" class="xp-label">Title:</label>
        <input type="search" id="add-search" class="xp-select" autocomplete="off"
               placeholder="Type a game name, e.g. Deus Ex" aria-label="Search for a game to add">
        <button type="submit" class="xp-button">Search</button>
      </form>
      <p class="field-note">Pick a result and choose where it belongs. No swiping required.</p>

      <div class="add-results xp-sunken" id="add-results">
        <p class="add-placeholder">Search for a game to get started.</p>
      </div>

      <details class="manual-block" id="manual-block">
        <summary>Not on IGDB? Add it by hand</summary>
        <p class="field-note">
          For anything the game database does not carry - homebrew, mods, fan
          translations, or something too obscure to be listed.
        </p>
        <div class="manual-fields">
          <label for="manual-title">Title *</label>
          <input type="text" id="manual-title" class="xp-select" maxlength="200" placeholder="Required">

          <label for="manual-year">Release year</label>
          <input type="number" id="manual-year" class="xp-select" min="1950" max="2100" placeholder="e.g. 1997">

          <label for="manual-platforms">Platform(s)</label>
          <input type="text" id="manual-platforms" class="xp-select" maxlength="200" placeholder="e.g. Amiga, DOS">

          <label for="manual-genres">Genre(s)</label>
          <input type="text" id="manual-genres" class="xp-select" maxlength="200" placeholder="e.g. Puzzle">

          <label for="manual-summary">Notes</label>
          <textarea id="manual-summary" class="xp-select" rows="2" maxlength="4000" placeholder="Optional"></textarea>
        </div>
        <div class="manual-actions">
          <span class="manual-status" id="manual-status"></span>
          <button type="button" class="xp-button xp-button-green" id="manual-create">Create &amp; Add</button>
        </div>
      </details>
    </div>

    <div class="xp-dialog-footer">
      <span class="add-footer-status" id="add-footer-status"></span>
      <button class="xp-button" data-add-close>Done</button>
    </div>
  </div>
</div>

<template id="tpl-add-row">
  <div class="add-row">
    <img class="add-cover" data-el="cover" alt="">
    <div class="add-info">
      <div class="add-title" data-el="title"></div>
      <div class="add-meta" data-el="meta"></div>
    </div>
    <div class="add-actions">
      <span class="status-pill add-current" data-el="current" hidden></span>
      <button class="xp-button xp-button-green add-btn" data-status="played">Played</button>
      <button class="xp-button xp-button-blue add-btn" data-status="backlog">Backlog</button>
      <button class="xp-button xp-button-red add-btn" data-status="skipped">Skipped</button>
    </div>
  </div>
</template>
`;

class AddGameDialog {
  /**
   * @param {(game, status, previousStatus) => void} onAdded
   *        Called after a game's status is saved, so the host page can react -
   *        the deck drops it from the queue, the catalog reloads its list.
   */
  constructor(onAdded = () => {}) {
    this.onAdded = onAdded;

    const host = document.createElement('div');
    host.innerHTML = ADD_GAME_MARKUP;   // static markup, no interpolation
    document.body.append(...host.children);

    this.modal = $('modal-add');
    this.results = $('add-results');
    this.footer = $('add-footer-status');

    $('add-search-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.search($('add-search').value);
    });

    this.modal.querySelectorAll('[data-add-close]')
      .forEach(b => b.addEventListener('click', () => this.close()));

    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });

    $('manual-create').addEventListener('click', () => this.createManual());
  }

  /**
   * Create a game IGDB does not have. It lands in the results list like any
   * other row, so the same three buttons file it.
   */
  async createManual() {
    const title = $('manual-title').value.trim();
    const status = $('manual-status');
    if (!title) {
      status.textContent = 'A title is required.';
      status.className = 'manual-status error-text';
      return;
    }

    const button = $('manual-create');
    button.disabled = true;
    status.textContent = 'Creating...';
    status.className = 'manual-status';

    const year = parseInt($('manual-year').value, 10);
    try {
      const { game } = await API.addManualGame({
        title,
        release_year: Number.isFinite(year) ? year : null,
        platforms: $('manual-platforms').value.trim(),
        genres: $('manual-genres').value.trim(),
        summary: $('manual-summary').value.trim()
      });

      ['manual-title', 'manual-year', 'manual-platforms', 'manual-genres', 'manual-summary']
        .forEach(id => { $(id).value = ''; });
      status.textContent = `"${game.title}" created - now pick a status above.`;
      status.className = 'manual-status ok-text';

      // put it at the top of the results so the status buttons are right there
      this.results.prepend(this.buildRow(game));
      this.results.scrollTop = 0;
    } catch (err) {
      status.textContent = err.message;
      status.className = 'manual-status error-text';
    } finally {
      button.disabled = false;
    }
  }

  isOpen() {
    return this.modal.classList.contains('open');
  }

  open() {
    this.footer.textContent = '';
    this.modal.classList.add('open');
    $('add-search').focus();
    $('add-search').select();
  }

  close() {
    this.modal.classList.remove('open');
  }

  placeholder(text, isError = false) {
    const p = document.createElement('p');
    p.className = isError ? 'add-placeholder error-text' : 'add-placeholder';
    p.textContent = text;
    return p;
  }

  async search(query) {
    if (!query.trim()) return;
    this.results.replaceChildren(this.placeholder(`Searching for "${query}"...`));

    try {
      // include_logged: a game already in the archive should show up with its
      // current status rather than silently going missing from the results
      const data = await API.searchGames(query, true);
      if (!data.games.length) {
        this.results.replaceChildren(this.placeholder(
          data.has_credentials
            ? `Nothing found for "${query}".`
            : 'No game database connected - finish setup under Options first.'));
        return;
      }
      this.results.replaceChildren(...data.games.map(g => this.buildRow(g)));
    } catch (err) {
      this.results.replaceChildren(this.placeholder(`Search failed: ${err.message}`, true));
    }
  }

  buildRow(game) {
    const { el: row, r } = clone('tpl-add-row');

    r.cover.src = game.cover_url || '';
    r.cover.alt = '';
    hideOnError(r.cover);
    r.title.textContent = game.title;
    r.meta.textContent = [
      game.release_year || 'Unknown year',
      (game.genres || 'Video Game').split(',')[0].trim(),
      game.rating ? `★ ${game.rating}` : '★ Unrated'
    ].join(' • ');

    this.markRow(row, r.current, game.status);

    row.querySelector('.add-actions').addEventListener('click', (e) => {
      const button = e.target.closest('.add-btn');
      if (button) this.save(game, button.dataset.status, row, r.current);
    });

    return row;
  }

  markRow(row, pill, status) {
    row.classList.toggle('is-logged', Boolean(status));
    pill.hidden = !status;
    pill.className = `status-pill add-current ${status || ''}`;
    if (status) pill.textContent = status;

    // highlight the status it already has, so the row shows its current state
    row.querySelectorAll('.add-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.status === status);
    });
  }

  async save(game, status, row, pill) {
    const buttons = row.querySelectorAll('.add-btn');
    buttons.forEach(b => { b.disabled = true; });

    try {
      await API.recordSwipe(game.igdb_id, status);
      const previous = game.status;
      game.status = status;
      this.markRow(row, pill, status);

      this.footer.textContent =
        `${game.title} - ${previous ? `moved to ${status}` : `added to ${status}`}.`;
      this.onAdded(game, status, previous);
    } catch (err) {
      this.footer.textContent = `Could not add: ${err.message}`;
    } finally {
      buttons.forEach(b => { b.disabled = false; });
    }
  }
}

window.AddGameDialog = AddGameDialog;

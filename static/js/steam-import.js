/**
 * STEAM-IMPORT.JS: bulk-import a Steam library, shared by the deck and catalog.
 *
 * Scanning is always a preview: a library is routinely hundreds of games, so
 * nothing is written until the user has seen the list and confirmed it.
 * Injects its own markup, like add-game.js, so both pages share one source.
 */

const STEAM_MARKUP = `
<div class="xp-modal-overlay" id="modal-steam" role="dialog" aria-labelledby="modal-steam-title" aria-modal="true">
  <div class="xp-dialog dialog-wide">
    <div class="xp-title-bar">
      <div class="xp-title-content">
        <svg class="xp-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1B2838"/><circle cx="15" cy="9" r="3.2" fill="none" stroke="#FFF" stroke-width="1.6"/><circle cx="8" cy="15" r="2.6" fill="#FFF"/><path stroke="#FFF" stroke-width="1.4" d="M8 15l7-6"/></svg>
        <span id="modal-steam-title">Import from Steam</span>
      </div>
      <button class="xp-win-btn close" data-steam-close aria-label="Close">&#10005;</button>
    </div>

    <div class="xp-dialog-body">
      <!-- One-time: the Steam Web API key -->
      <fieldset class="xp-fieldset" id="steam-key-block">
        <legend>Step 1 &mdash; Steam Web API key</legend>
        <p class="field-note">
          Free, instant, and tied to your Steam account. Open
          <a href="https://steamcommunity.com/dev/apikey" target="_blank" rel="noopener noreferrer">steamcommunity.com/dev/apikey</a>,
          enter any domain name (<code>localhost</code> is fine), and copy the key.
        </p>
        <div class="steam-key-row">
          <input type="password" id="steam-key" class="xp-select" autocomplete="off"
                 placeholder="32-character key" aria-label="Steam Web API key">
          <button type="button" class="xp-button xp-button-green" id="steam-key-save">Verify &amp; Save</button>
        </div>
        <p class="setup-status" id="steam-key-status" hidden></p>
      </fieldset>

      <fieldset class="xp-fieldset" id="steam-scan-block">
        <legend>Step 2 &mdash; Your library</legend>
        <p class="field-note" id="steam-privacy-note">
          Your Steam profile's <strong>Game details</strong> must be set to Public,
          otherwise Steam reports an empty library.
        </p>
        <div class="steam-scan-fields">
          <label for="steam-profile">Profile</label>
          <input type="text" id="steam-profile" class="xp-select" autocomplete="off"
                 placeholder="Profile name, SteamID64, or profile URL">

          <label for="steam-min-hours">Only import games played at least</label>
          <div class="steam-hours-row">
            <input type="number" id="steam-min-hours" class="xp-select" min="0" max="10000" step="0.5" value="1">
            <span>hour(s)</span>
            <button type="button" class="xp-button" id="steam-scan-btn">Scan Library</button>
          </div>

          <label for="steam-status">Import them as</label>
          <select id="steam-status" class="xp-select">
            <option value="played">Played</option>
            <option value="backlog">Backlog</option>
          </select>
        </div>
      </fieldset>

      <div id="steam-results-block" hidden>
        <div class="steam-summary" id="steam-summary"></div>

        <div class="steam-tabs">
          <button type="button" class="xp-tab active" data-tab="matched" id="steam-tab-matched">Ready to import</button>
          <button type="button" class="xp-tab" data-tab="unmatched" id="steam-tab-unmatched">Not on IGDB</button>
        </div>

        <div class="steam-list xp-sunken" id="steam-matched"></div>
        <div class="steam-list xp-sunken" id="steam-unmatched" hidden></div>
      </div>
    </div>

    <div class="xp-dialog-footer">
      <span class="add-footer-status" id="steam-footer-status"></span>
      <button class="xp-button xp-button-green" id="steam-import-btn" hidden>Import</button>
      <button class="xp-button" data-steam-close>Close</button>
    </div>
  </div>
</div>

<template id="tpl-steam-row">
  <label class="steam-row">
    <input type="checkbox" class="steam-check" checked>
    <img class="add-cover" data-el="cover" alt="">
    <div class="add-info">
      <div class="add-title" data-el="title"></div>
      <div class="add-meta" data-el="meta"></div>
    </div>
    <span class="status-pill add-current" data-el="current" hidden></span>
    <span class="steam-hours" data-el="hours"></span>
  </label>
</template>

<template id="tpl-steam-miss">
  <div class="steam-row is-miss">
    <div class="add-info">
      <div class="add-title" data-el="title"></div>
      <div class="add-meta">Not found in the game database</div>
    </div>
    <span class="steam-hours" data-el="hours"></span>
  </div>
</template>
`;

class SteamImportDialog {
  /** @param {() => void} onImported Called after a successful import. */
  constructor(onImported = () => {}) {
    this.onImported = onImported;
    this.matched = [];

    const host = document.createElement('div');
    host.innerHTML = STEAM_MARKUP;   // static markup, no interpolation
    document.body.append(...host.children);

    this.modal = $('modal-steam');

    this.modal.querySelectorAll('[data-steam-close]')
      .forEach(b => b.addEventListener('click', () => this.close()));
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen()) this.close();
    });

    $('steam-key-save').addEventListener('click', () => this.saveKey());
    $('steam-scan-btn').addEventListener('click', () => this.scan());
    $('steam-import-btn').addEventListener('click', () => this.runImport());
    $('steam-profile').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.scan(); }
    });

    $('steam-tab-matched').addEventListener('click', () => this.showTab('matched'));
    $('steam-tab-unmatched').addEventListener('click', () => this.showTab('unmatched'));
  }

  isOpen() { return this.modal.classList.contains('open'); }
  close() { this.modal.classList.remove('open'); }

  async open() {
    $('steam-footer-status').textContent = '';
    this.modal.classList.add('open');

    try {
      const { has_api_key, profile } = await API.getSteamStatus();
      // the key only needs entering once, so collapse that step afterwards
      $('steam-key-block').hidden = has_api_key;
      $('steam-profile').value = profile || '';
      (has_api_key ? $('steam-profile') : $('steam-key')).focus();
    } catch {
      $('steam-key-block').hidden = false;
    }
  }

  setStatus(el, message, kind) {
    el.hidden = false;
    el.textContent = message;
    el.className = `setup-status setup-${kind}`;
  }

  async saveKey() {
    const key = $('steam-key').value.trim();
    const status = $('steam-key-status');
    if (!key) {
      this.setStatus(status, 'Paste your Steam API key first.', 'error');
      return;
    }

    const button = $('steam-key-save');
    button.disabled = true;
    this.setStatus(status, 'Checking the key with Steam...', 'busy');
    try {
      await API.saveSteamKey(key);
      this.setStatus(status, 'Key saved. Now enter your profile below.', 'ok');
      $('steam-key').value = '';
      setTimeout(() => { $('steam-key-block').hidden = true; $('steam-profile').focus(); }, 900);
    } catch (err) {
      this.setStatus(status, err.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async scan() {
    const profile = $('steam-profile').value.trim();
    const footer = $('steam-footer-status');
    if (!profile) {
      footer.textContent = 'Enter your Steam profile name or ID.';
      return;
    }

    const button = $('steam-scan-btn');
    button.disabled = true;
    footer.textContent = 'Reading your Steam library...';
    $('steam-results-block').hidden = true;
    $('steam-import-btn').hidden = true;

    try {
      const data = await API.scanSteamLibrary(profile, Number($('steam-min-hours').value) || 0);
      this.matched = data.matched;
      this.render(data);
      footer.textContent = '';
    } catch (err) {
      footer.textContent = err.message;
    } finally {
      button.disabled = false;
    }
  }

  render(data) {
    const alreadyLogged = data.matched.filter(g => g.current_status).length;
    $('steam-summary').textContent =
      `${data.total_owned} games owned - ${data.after_filter} past the hours filter - `
      + `${data.matched.length} matched`
      + (alreadyLogged ? `, ${alreadyLogged} already in your archive` : '')
      + (data.unmatched.length ? `, ${data.unmatched.length} not on IGDB` : '');

    $('steam-tab-matched').textContent = `Ready to import (${data.matched.length})`;
    $('steam-tab-unmatched').textContent = `Not on IGDB (${data.unmatched.length})`;

    $('steam-matched').replaceChildren(...data.matched.map(g => this.buildRow(g)));
    $('steam-unmatched').replaceChildren(...data.unmatched.map(g => this.buildMiss(g)));

    $('steam-results-block').hidden = false;
    $('steam-import-btn').hidden = data.matched.length === 0;
    this.showTab('matched');
    this.updateImportLabel();
  }

  buildRow(game) {
    const { el: row, r } = clone('tpl-steam-row');
    r.cover.src = game.cover_url || '';
    hideOnError(r.cover);
    r.title.textContent = game.title;
    r.meta.textContent = game.release_year ? String(game.release_year) : 'Unknown year';
    r.hours.textContent = `${game.hours_played} h`;

    if (game.current_status) {
      r.current.hidden = false;
      r.current.className = `status-pill add-current ${game.current_status}`;
      r.current.textContent = game.current_status;
    }

    const check = row.querySelector('.steam-check');
    // already-logged games start unticked, so a re-import does not quietly
    // overwrite hours or a status the user set by hand
    check.checked = !game.current_status;
    check.dataset.igdbId = game.igdb_id;
    check.dataset.hours = game.hours_played;
    check.addEventListener('change', () => this.updateImportLabel());

    return row;
  }

  buildMiss(game) {
    const { el: row, r } = clone('tpl-steam-miss');
    r.title.textContent = game.name;
    r.hours.textContent = `${game.hours_played} h`;
    return row;
  }

  showTab(which) {
    $('steam-tab-matched').classList.toggle('active', which === 'matched');
    $('steam-tab-unmatched').classList.toggle('active', which === 'unmatched');
    $('steam-matched').hidden = which !== 'matched';
    $('steam-unmatched').hidden = which !== 'unmatched';
  }

  selected() {
    return [...this.modal.querySelectorAll('.steam-check:checked')].map(c => ({
      igdb_id: Number(c.dataset.igdbId),
      hours_played: Number(c.dataset.hours)
    }));
  }

  updateImportLabel() {
    const count = this.selected().length;
    const button = $('steam-import-btn');
    button.textContent = `Import ${count} game${count === 1 ? '' : 's'}`;
    button.disabled = count === 0;
  }

  async runImport() {
    const games = this.selected();
    if (!games.length) return;

    const button = $('steam-import-btn');
    button.disabled = true;
    $('steam-footer-status').textContent = `Importing ${games.length} games...`;

    try {
      const { imported } = await API.importSteamGames(games, $('steam-status').value);
      $('steam-footer-status').textContent =
        `Imported ${imported} game${imported === 1 ? '' : 's'} as ${$('steam-status').value}.`;
      this.onImported();
      // reflect the new state without a second Steam round-trip
      this.matched.forEach(g => {
        if (games.some(s => s.igdb_id === g.igdb_id)) g.current_status = $('steam-status').value;
      });
      $('steam-matched').replaceChildren(...this.matched.map(g => this.buildRow(g)));
      this.updateImportLabel();
    } catch (err) {
      $('steam-footer-status').textContent = err.message;
    } finally {
      // recompute rather than blindly re-enabling: with nothing selected the
      // button must stay disabled
      this.updateImportLabel();
    }
  }
}

window.SteamImportDialog = SteamImportDialog;

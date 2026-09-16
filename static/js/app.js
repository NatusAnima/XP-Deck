/**
 * APP.JS: XP-Deck coordinator - deck state, rendering, and controls.
 *
 * Rendering goes through <template> + textContent rather than innerHTML, so
 * game titles and summaries coming back from IGDB are never parsed as markup.
 * $, clone, gameLinks and hideOnError come from shared.js.
 */

/** Display-ready fields with fallbacks, shared by the card and the inspector. */
function displayFields(game) {
  const genres = game.genres || 'Video Game';
  const platforms = game.platforms || 'Multiple Platforms';
  return {
    genres,
    platforms,
    primaryGenre: genres.split(',')[0].trim(),
    primaryPlatform: platforms.split(',')[0].trim(),
    rating: game.rating ? `★ ${game.rating}` : '★ Unrated',
    year: game.release_year || '—'
  };
}

const STACK_SIZE = 5;
const PAGE_SIZE = 30;
// Pull the next page once the queue gets this short. Without it the deck runs
// out at 30 and claims "Year Complete!" while the server still has unswiped
// games cached - and the progress bar sits still through the whole page.
const REFILL_AT = 8;
const SORT_LABELS = {
  popular: 'Most rated',
  rating: 'Highest rated',
  newest: 'Newest first',
  oldest: 'Oldest first'
};

const STORE = {
  filter: 'xp_deck_filter',
  sound: 'xp_sound_enabled',
  duration: 'xp_rating_duration',
  quickTag: 'xp_quicktag_enabled'
};

class XPDeckApp {
  constructor() {
    this.queue = [];
    this.renderedCards = [];
    this.stats = null;
    this.soundEnabled = true;
    this.mode = 'year';           // 'year' | 'search'
    this.hasMore = true;
    this.igdbOffset = 0;
    this.filterTotal = null;  // how many games IGDB has for the active filter
    this.reviewed = 0;
    this.cached = 0;
    this.hasCredentials = true;

    this.filter = this.readStoredFilter();
    this.ratingDurationSeconds = 10;
    this.quickTagEnabled = true;
    this.quickTagActive = false;
    this.quickTagTimer = null;
    this.pendingPlayedGame = null;
    this.selectedRating = null;

    this.viewerImages = [];
    this.viewerIndex = 0;
    this.audioCtx = null;

    this.init();
  }

  /** The deck filter, restored from the last session. */
  readStoredFilter() {
    const fallback = { yearFrom: 2004, yearTo: 2004, genre: '', minRatings: 0, sort: 'popular' };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE.filter));
      return saved && typeof saved === 'object' ? { ...fallback, ...saved } : fallback;
    } catch {
      return fallback;
    }
  }

  saveFilter() {
    localStorage.setItem(STORE.filter, JSON.stringify(this.filter));
  }

  /** Short description of the active filter, for the toolbar and messages. */
  describeFilter() {
    const { yearFrom, yearTo, genre, minRatings, sort } = this.filter;
    const bits = [
      yearFrom == null ? 'All time'
        : yearFrom === yearTo ? String(yearFrom)
        : `${yearFrom}-${yearTo}`
    ];
    if (genre) bits.push(genre);
    if (sort !== 'popular') bits.push(SORT_LABELS[sort] || sort);
    if (minRatings > 0) bits.push(`${minRatings}+ ratings`);
    return bits.join(' · ');
  }

  async init() {
    this.initAudio();
    this.initScopeSelector();
    this.initMenu();
    this.initControls();
    this.initModals();
    this.gestures = new CardGestures(
      $('deck-container'),
      (card, action) => this.onCardSwiped(card, action),
      () => this.flipTopCard()
    );
    this.shortcuts = new KeyboardShortcuts(this);
    this.addDialog = new AddGameDialog((g, status, prev) => this.onGameAdded(g, status, prev));
    // a bulk import can touch anything, so reload rather than patch counters
    this.steamDialog = new SteamImportDialog(async () => {
      await this.refreshStats();
      await this.loadDeck();
    });

    await this.loadSettings();
    await this.refreshStats();
    await this.loadDeck();

    // First run: no credentials means no games can ever load, so explain that
    // before the user stares at an empty deck wondering what is broken.
    if (!this.hasCredentials) this.openSetup(true);
  }

  // =========================================================================
  // First-run setup
  // =========================================================================
  openSetup(firstRun = false) {
    this.playSound('click');
    $('setup-skip-btn').textContent = firstRun ? 'Skip for now' : 'Cancel';
    $('setup-close-btn').hidden = firstRun;   // no escape hatch on first run
    $('setup-status').hidden = true;
    $('modal-setup').classList.add('open');
    $('setup-client-id').focus();
  }

  setSetupStatus(message, kind) {
    const el = $('setup-status');
    el.hidden = false;
    el.textContent = message;
    el.className = `setup-status setup-${kind}`;
  }

  async saveSetup() {
    const id = $('setup-client-id').value.trim();
    const secret = $('setup-client-secret').value.trim();

    if (!id || !secret) {
      this.setSetupStatus('Enter both the Client ID and the Client Secret.', 'error');
      return;
    }

    const button = $('setup-save-btn');
    button.disabled = true;
    this.setSetupStatus('Checking your keys with Twitch...', 'busy');

    try {
      await API.saveSetup(id, secret);
      this.setSetupStatus('Connected. Loading your first games...', 'ok');
      this.playSound('played');
      $('setup-client-secret').value = '';
      setTimeout(async () => {
        this.closeModals();
        await this.loadDeck();
      }, 900);
    } catch (err) {
      this.setSetupStatus(err.message, 'error');
      this.playSound('error');
    } finally {
      button.disabled = false;
    }
  }

  // =========================================================================
  // Settings
  // =========================================================================
  async loadSettings() {
    let duration = null;
    let quickTag = null;
    try {
      const s = await API.getSettings();
      duration = s.rating_duration_seconds;
      quickTag = s.quick_tag_enabled;
    } catch {
      duration = localStorage.getItem(STORE.duration);
      quickTag = localStorage.getItem(STORE.quickTag);
    }

    // A malformed value used to yield NaN, and setTimeout(fn, NaN) fires
    // immediately - auto-saving the rating before it could be entered.
    const parsed = parseInt(duration, 10);
    this.ratingDurationSeconds = Number.isFinite(parsed) ? Math.max(0, parsed) : 10;
    // absent means "never set", which is the default: on
    this.quickTagEnabled = quickTag === null || quickTag === undefined
      ? true
      : !['0', 'false'].includes(String(quickTag));

    $('setting-rating-duration').value = this.ratingDurationSeconds;
    $('setting-quicktag-enabled').checked = this.quickTagEnabled;
    this.updateDurationLabel(this.ratingDurationSeconds);
    this.updateQuickTagToggleUI(this.quickTagEnabled);
  }

  /** Reset the form to the saved values, so Cancel really cancels. */
  openPreferences() {
    $('setting-rating-duration').value = this.ratingDurationSeconds;
    $('setting-quicktag-enabled').checked = this.quickTagEnabled;
    this.updateDurationLabel(this.ratingDurationSeconds);
    this.updateQuickTagToggleUI(this.quickTagEnabled);
    this.openModal('modal-options');
  }

  /** The timer only means anything while the popover is in play. */
  updateQuickTagToggleUI(enabled) {
    $('setting-duration-group').classList.toggle('disabled', !enabled);
    $('setting-rating-duration').disabled = !enabled;
  }

  updateDurationLabel(seconds) {
    $('setting-duration-label').textContent =
      seconds === 0 ? 'Manual (no auto-save)' : `${seconds} seconds`;
  }

  async saveSettings(duration, quickTagEnabled) {
    // A popover already on screen would be orphaned by turning the feature
    // off, so close it out first - keeping whatever was entered.
    if (!quickTagEnabled && this.pendingPlayedGame) this.finishQuickTag(true);

    this.ratingDurationSeconds = duration;
    this.quickTagEnabled = quickTagEnabled;
    localStorage.setItem(STORE.duration, String(duration));
    localStorage.setItem(STORE.quickTag, quickTagEnabled ? '1' : '0');

    const summary = quickTagEnabled
      ? `Quick-tag on, auto-saving after ${duration}s.`
      : 'Quick-tag off - Played swipes save straight away.';

    try {
      await API.updateSettings(duration, quickTagEnabled);
      this.setStatus(summary);
    } catch {
      this.setStatus(`${summary} (saved on this device only)`);
    }
  }

  // =========================================================================
  // Audio - short synthesized blips, no asset files
  // =========================================================================
  initAudio() {
    const saved = localStorage.getItem(STORE.sound);
    if (saved !== null) this.soundEnabled = saved === 'true';
    this.applySoundState();

    // Browsers only allow an AudioContext after a user gesture.
    const unlock = () => {
      if (!this.audioCtx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) this.audioCtx = new Ctx();
      }
      this.audioCtx?.resume();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    localStorage.setItem(STORE.sound, String(this.soundEnabled));
    this.applySoundState();
    if (this.soundEnabled) this.playSound('click');
  }

  applySoundState() {
    document.body.classList.toggle('sound-off', !this.soundEnabled);
    const text = this.soundEnabled ? 'Sound: ON' : 'Sound: OFF';
    document.querySelectorAll('.sound-label').forEach(el => { el.textContent = text; });
  }

  /** Play a short envelope over one or more tones. */
  beep(tones, { type = 'sine', gain = 0.12, spacing = 0, decay = 0.2 } = {}) {
    if (!this.soundEnabled || !this.audioCtx) return;
    const now = this.audioCtx.currentTime;

    tones.forEach(([from, to], i) => {
      const at = now + i * spacing;
      const osc = this.audioCtx.createOscillator();
      const vol = this.audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, at);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, at + decay);
      vol.gain.setValueAtTime(gain, at);
      vol.gain.exponentialRampToValueAtTime(0.001, at + decay);
      osc.connect(vol).connect(this.audioCtx.destination);
      osc.start(at);
      osc.stop(at + decay + 0.02);
    });
  }

  playSound(kind) {
    const sounds = {
      click: () => this.beep([[1400, 300]], { type: 'triangle', gain: 0.15, decay: 0.04 }),

      // One sound per swipe direction, shaped like the gesture: skipping
      // sweeps down and away, backlog sweeps up, played is a rising chime.
      skipped: () => this.beep([[350, 110]], { gain: 0.12, decay: 0.14 }),
      backlog: () => this.beep([[330, 880]], { type: 'triangle', gain: 0.10, decay: 0.18 }),
      played: () => this.beep([[523.25], [659.25], [783.99]], { spacing: 0.02, decay: 0.35 }),

      undo: () => this.beep([[440], [554.37]], { gain: 0.1, spacing: 0.06, decay: 0.2 }),
      error: () => this.beep([[320], [220]], { type: 'square', gain: 0.1, spacing: 0.1, decay: 0.18 })
    };
    sounds[kind]?.();
  }

  // =========================================================================
  // Year selection & loading
  // =========================================================================
  /** Scope select: All time, each decade, then each individual year. */
  initScopeSelector() {
    const select = $('year-select');
    const thisYear = new Date().getFullYear();

    select.add(new Option('All time', 'all'));

    const decades = document.createElement('optgroup');
    decades.label = 'Decades';
    for (let d = Math.floor(thisYear / 10) * 10; d >= 1970; d -= 10) {
      decades.append(new Option(`${d}s`, `${d}-${d + 9}`));
    }
    select.add(decades);

    const years = document.createElement('optgroup');
    years.label = 'Years';
    for (let y = thisYear; y >= 1970; y--) years.append(new Option(y, `${y}-${y}`));
    select.add(years);

    select.value = this.scopeValue();
    select.addEventListener('change', (e) => {
      this.playSound('click');
      const [from, to] = e.target.value === 'all' ? [null, null]
        : e.target.value.split('-').map(Number);
      this.filter.yearFrom = from;
      this.filter.yearTo = to;
      this.loadDeck();
    });
  }

  /** Populate the genre list and open the filter dialog. */
  async openFilters() {
    this.playSound('click');
    const select = $('filter-genre');

    if (select.options.length <= 1) {
      try {
        const { genres } = await API.getGenres();
        genres.forEach(g => select.add(new Option(g.name, g.name)));
      } catch {
        // leave "All genres" as the only option; the deck still works
      }
    }

    // reflect saved values, so Cancel genuinely cancels
    select.value = this.filter.genre || '';
    $('filter-sort').value = this.filter.sort;
    $('filter-min-ratings').value = this.filter.minRatings;
    this.updateRatingsHint();
    this.openModal('modal-filters');
  }

  updateRatingsHint() {
    const n = Number($('filter-min-ratings').value) || 0;
    const sort = $('filter-sort').value;
    $('filter-ratings-hint').textContent =
      n === 0
        ? (sort === 'rating' ? 'With no floor, "highest rated" returns obscure games.' : 'No floor - everything IGDB has.')
        : `Only games at least ${n} people have rated.`;
  }

  applyFilters() {
    this.filter.genre = $('filter-genre').value;
    this.filter.sort = $('filter-sort').value;
    this.filter.minRatings = Math.max(0, Number($('filter-min-ratings').value) || 0);
    this.closeModals();
    this.loadDeck();
  }

  resetFilters() {
    $('filter-genre').value = '';
    $('filter-sort').value = 'popular';
    $('filter-min-ratings').value = 0;
    this.updateRatingsHint();
  }

  scopeValue() {
    const { yearFrom, yearTo } = this.filter;
    return yearFrom == null ? 'all' : `${yearFrom}-${yearTo}`;
  }

  /** Reload the deck from scratch for the current filter. */
  async loadDeck() {
    this.mode = 'deck';
    this.igdbOffset = 0;
    this.saveFilter();
    $('deck-search').value = '';

    const select = $('year-select');
    // an arbitrary saved range may not be one of the presets
    if (select.value !== this.scopeValue()) {
      select.value = [...select.options].some(o => o.value === this.scopeValue())
        ? this.scopeValue() : 'all';
    }
    $('filter-summary').textContent = this.describeFilter();

    this.setStatus(`Loading ${this.describeFilter()}...`);
    await this.fetchDeck();
  }

  async fetchDeck() {
    try {
      const data = await API.getDeck(this.filter, PAGE_SIZE, this.igdbOffset);
      this.queue = data.games;
      this.hasMore = data.has_more;
      this.igdbOffset = data.igdb_offset;
      this.hasCredentials = data.has_credentials;
      this.filterTotal = data.filter_total ?? null;
      this.reviewed = data.reviewed;
      this.cached = data.cached;

      this.renderStack();
      this.setStatus(
        this.queue.length
          ? `Ready. ${this.queue.length} games queued - ${this.describeFilter()}.`
          : `No unreviewed games left for ${this.describeFilter()}.`
      );
    } catch (err) {
      this.queue = [];
      this.renderStack();
      this.setStatus(`Could not load the deck: ${err.message}`, true);
    }
  }

  /**
   * Append the next page to the queue without disturbing the visible stack.
   * Runs automatically as the deck gets low, so swiping never stalls.
   */
  async extendDeck() {
    if (this.extending) return;
    this.extending = true;
    try {
      const data = await API.getDeck(this.filter, PAGE_SIZE, this.igdbOffset);
      this.hasMore = data.has_more;
      this.igdbOffset = data.igdb_offset;
      this.filterTotal = data.filter_total ?? this.filterTotal;
      this.cached = data.cached;

      const known = new Set(this.queue.map(g => g.igdb_id));
      const fresh = data.games.filter(g => !known.has(g.igdb_id));
      if (fresh.length) {
        this.queue.push(...fresh);
        this.restack();
      }
    } catch {
      // a failed top-up is not worth interrupting the user over; Load More
      // is still there if the deck does run dry
    } finally {
      this.extending = false;
    }
  }

  /** Explicit "Download Next 30" from the empty state. */
  async loadMore() {
    this.playSound('click');
    this.setStatus('Fetching more games from IGDB...');
    await this.fetchDeck();
  }

  /** Move to the next decade or year, depending on the current scope. */
  advanceScope() {
    this.playSound('click');
    const { yearFrom, yearTo } = this.filter;
    if (yearFrom == null) return;

    const span = yearTo - yearFrom + 1;
    const maxYear = new Date().getFullYear();
    let from = yearFrom + span;
    if (from > maxYear) from = 1970;
    this.filter.yearFrom = from;
    this.filter.yearTo = Math.min(from + span - 1, maxYear);
    this.loadDeck();
  }

  async runSearch(query) {
    if (!query.trim()) {
      this.loadDeck();
      return;
    }

    this.playSound('click');
    this.setStatus(`Searching for "${query}"...`);
    try {
      const data = await API.searchGames(query);
      this.mode = 'search';
      this.searchQuery = query;
      this.queue = data.games;
      this.hasMore = false;
      this.renderStack();

      this.setStatus(
        this.queue.length
          ? `${this.queue.length} result${this.queue.length === 1 ? '' : 's'} for "${query}". Swipe as usual.`
          : `Nothing found for "${query}".`
      );
    } catch (err) {
      this.setStatus(`Search failed: ${err.message}`, true);
    }
  }

  // =========================================================================
  // Card stack
  // =========================================================================
  renderStack() {
    const container = $('deck-container');
    container.querySelectorAll('.game-card').forEach(c => c.remove());
    this.renderedCards = [];

    this.queue.slice(0, STACK_SIZE).forEach(game => {
      const card = this.buildCard(game);
      container.appendChild(card);
      this.renderedCards.push(card);
    });

    this.restack();
  }

  /** Re-apply stack depth indices and sync the top card, inspector and counts. */
  restack() {
    this.renderedCards.forEach((card, i) => { card.dataset.index = i; });

    const top = this.renderedCards[0] || null;
    this.gestures.attachTopCard(top);
    this.updateInspector(top ? this.queue[0] : null);

    $('deck-empty').classList.toggle('visible', this.renderedCards.length === 0);
    if (!this.renderedCards.length) this.updateEmptyState();

    $('status-queue').textContent = `Cards Left: ${this.queue.length}`;
    this.updateProgress();
  }

  updateEmptyState() {
    const isSearch = this.mode === 'search';
    const noKeys = !this.hasCredentials;

    // An unconfigured app has no games for a reason that has nothing to do
    // with the year, so it gets its own wording rather than "Year Complete!".
    const exhausted = !this.hasMore && !isSearch && !noKeys;

    if (noKeys) {
      $('empty-heading').textContent = 'Almost there';
      $('empty-message').textContent = 'XP-Deck needs to be connected to the game database before it can show you anything.';
    } else if (isSearch) {
      $('empty-heading').textContent = 'No Results';
      $('empty-message').textContent = `Nothing matched "${this.searchQuery || ''}".`;
    } else {
      $('empty-heading').textContent = 'Year Complete!';
      $('empty-message').textContent = `You have reviewed everything matching ${this.describeFilter()}.`;
    }

    const note = $('empty-note');
    note.hidden = !exhausted;
    if (exhausted) note.textContent = 'No additional games found on IGDB for this year.';

    const loadMore = $('empty-load-more-btn');
    loadMore.hidden = noKeys;
    loadMore.disabled = isSearch || exhausted;
    loadMore.textContent = exhausted ? 'No More Games on IGDB' : 'Download Next 30 Games';

    const nextYear = $('empty-next-year-btn');
    // "next" only means something when the scope is a year or a decade
    nextYear.hidden = isSearch || noKeys || this.filter.yearFrom == null;
    nextYear.textContent = this.filter.yearFrom === this.filter.yearTo
      ? `Advance to ${this.filter.yearFrom + 1}`
      : 'Advance to the Next Decade';

    const setupBtn = $('empty-setup-btn');
    setupBtn.hidden = !noKeys;
  }

  buildCard(game) {
    const { el: card, r } = clone('tpl-card');
    const d = displayFields(game);

    card.dataset.id = game.igdb_id;

    r.cover.src = game.cover_url || '';
    r.cover.alt = `${game.title} cover art`;
    hideOnError(r.cover);   // a missing cover leaves the dark card background

    r.rating.textContent = d.rating;
    r.year.textContent = d.year;
    r.genre.textContent = d.primaryGenre;
    r.title.textContent = game.title;
    r.platforms.textContent = d.platforms;

    r.backTitle.textContent = `${game.title} (${d.year})`;
    r.sub.textContent = `${d.rating} • ${d.primaryGenre} • ${d.primaryPlatform}`;
    r.summary.textContent = game.summary || 'No description available for this title.';

    const links = gameLinks(game.title);
    r.steam.href = links.steam;
    r.gog.href = links.gog;
    r.google.href = links.google;

    // The card back is the only screenshot gallery on mobile, where the
    // inspector pane is hidden.
    const shots = game.screenshots || [];
    if (shots.length) {
      r.shotsWrap.hidden = false;
      shots.forEach((src, i) => {
        const img = document.createElement('img');
        img.className = 'screenshot-thumb';
        img.src = src;
        img.alt = `${game.title} screenshot ${i + 1}`;
        img.dataset.idx = i;
        r.shots.appendChild(img);
      });
      r.shots.addEventListener('click', (e) => {
        const thumb = e.target.closest('.screenshot-thumb');
        if (thumb) this.openViewer(shots, Number(thumb.dataset.idx), game.title);
      });
    }

    card.querySelector('.card-back-close')
      .addEventListener('click', () => this.flipTopCard());

    return card;
  }

  flipTopCard() {
    const top = this.renderedCards[0];
    if (!top) return;
    this.playSound('click');
    top.classList.toggle('flipped');
  }

  handleSwipeAction(action) {
    this.gestures.triggerAction(action);
  }

  onCardSwiped(cardEl, action) {
    this.playSound(action);

    const game = this.queue.shift();
    this.renderedCards.shift();

    if (game) {
      // With quick-tag switched off, a Played swipe saves in one motion.
      if (action === 'played' && this.quickTagEnabled) this.openQuickTag(game);
      else this.commitSwipe(game, action);
    }

    // let the fly-off animation finish before the node goes away
    setTimeout(() => cardEl.remove(), 300);
    this.topUpStack();
  }

  topUpStack() {
    if (this.mode === 'deck' && this.queue.length <= REFILL_AT && this.hasMore) {
      this.extendDeck();
    }

    if (this.renderedCards.length < STACK_SIZE) {
      const next = this.queue[this.renderedCards.length];
      if (next) {
        const card = this.buildCard(next);
        $('deck-container').appendChild(card);
        this.renderedCards.push(card);
      }
    }
    this.restack();
  }

  /** Put a game back on top of the deck (undo, or a failed save). */
  restoreToDeck(game) {
    if (this.queue.some(g => g.igdb_id === game.igdb_id)) return;

    this.queue.unshift(game);
    const card = this.buildCard(game);
    card.classList.add('card-returning');
    $('deck-container').insertBefore(card, $('deck-container').firstElementChild);
    this.renderedCards.unshift(card);

    // drop any card pushed past the visible stack depth
    while (this.renderedCards.length > STACK_SIZE) {
      this.renderedCards.pop().remove();
    }
    requestAnimationFrame(() => card.classList.remove('card-returning'));
    this.restack();
  }

  /**
   * Save a swipe. The card has already flown off - that snappiness is the
   * point - so a failed write puts the game back rather than losing it.
   */
  async commitSwipe(game, status, details = {}) {
    try {
      await API.recordSwipe(
        game.igdb_id, status, details.platform, details.hours, details.rating
      );
      this.applyStatDelta(status, 1, game.release_year);
    } catch (err) {
      this.playSound('error');
      this.restoreToDeck(game);
      this.setStatus(`Could not save "${game.title}" - card returned to the deck. ${err.message}`, true);
    }
  }

  // =========================================================================
  // Quick-tag popover
  // =========================================================================
  openQuickTag(game) {
    if (this.pendingPlayedGame) this.finishQuickTag(true);

    this.pendingPlayedGame = game;
    this.selectedRating = null;
    this.quickTagActive = true;

    // Touching the popover at all means the swipe was deliberate, so stop the
    // countdown and let the user take as long as they like. An accidental
    // swipe is never touched, so it still auto-saves and clears itself.
    this.quickTagAbort?.abort();
    this.quickTagAbort = new AbortController();
    const popoverEl = $('quicktag-popover');
    for (const evt of ['pointerdown', 'keydown', 'input', 'change']) {
      popoverEl.addEventListener(evt, () => this.stopQuickTagTimer(),
        { signal: this.quickTagAbort.signal });
    }

    $('quicktag-title').textContent = `Tagged: ${game.title}`;
    $('quicktag-hours').value = '';

    const platforms = $('quicktag-platform');
    platforms.replaceChildren(new Option('(Select Platform)', ''));
    (game.platforms || '').split(',').map(p => p.trim()).filter(Boolean)
      .forEach((p, i) => {
        platforms.add(new Option(p, p));
        if (i === 0) platforms.value = p;
      });

    this.setRatingButtons(null);
    $('quicktag-popover').classList.add('visible');
    this.armQuickTagTimer(this.ratingDurationSeconds);
  }

  /** Start (or restart) the auto-save countdown. 0 seconds means manual. */
  armQuickTagTimer(seconds) {
    clearTimeout(this.quickTagTimer);
    const fill = $('quicktag-timer-fill');
    const label = $('quicktag-timer');

    this.quickTagTimer = null;
    fill.classList.remove('paused');

    if (seconds <= 0) {
      label.textContent = 'Manual - click Save when done';
      fill.style.transition = 'none';
      fill.style.width = '100%';
      return;
    }

    label.textContent = `Auto-saving in ${seconds}s...`;
    fill.style.transition = 'none';
    fill.style.width = '100%';
    fill.getBoundingClientRect();           // flush, so the transition restarts
    fill.style.transition = `width ${seconds}s linear`;
    fill.style.width = '0%';

    this.quickTagTimer = setTimeout(() => this.finishQuickTag(true), seconds * 1000);
  }

  /** Cancel the countdown, freezing the bar where it stands. */
  stopQuickTagTimer() {
    if (!this.quickTagTimer) return;   // already stopped, or manual mode
    clearTimeout(this.quickTagTimer);
    this.quickTagTimer = null;

    const fill = $('quicktag-timer-fill');
    fill.style.width = getComputedStyle(fill).width;   // freeze mid-transition
    fill.style.transition = 'none';
    fill.classList.add('paused');
    $('quicktag-timer').textContent = 'Timer stopped - save when ready';
  }

  setQuickRating(rating) {
    this.selectedRating = rating;
    this.setRatingButtons(rating);
    // Picking a rating counts as interacting, so the countdown stops. It used
    // to *shorten* to a few seconds, which rushed anyone adding hours too.
    this.stopQuickTagTimer();
  }

  setRatingButtons(rating) {
    document.querySelectorAll('.rating-btn').forEach(btn => {
      const on = Number(btn.dataset.val) === rating;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    });
  }

  /**
   * Close the popover. The swipe itself is always saved - the user did mark
   * the game played - `withDetails` only decides whether the platform, hours
   * and rating go with it.
   */
  finishQuickTag(withDetails) {
    const game = this.pendingPlayedGame;
    if (!game) return;

    clearTimeout(this.quickTagTimer);
    this.quickTagTimer = null;
    this.quickTagAbort?.abort();
    this.pendingPlayedGame = null;
    this.quickTagActive = false;
    $('quicktag-popover').classList.remove('visible');

    const hours = parseInt($('quicktag-hours').value, 10);
    this.commitSwipe(game, 'played', withDetails ? {
      platform: $('quicktag-platform').value || null,
      hours: Number.isFinite(hours) ? hours : null,
      rating: this.selectedRating
    } : {});
  }

  // =========================================================================
  // Undo
  // =========================================================================
  async undoLastSwipe() {
    // a pending quick-tag has not been written yet; close it out first so undo
    // does not race the save
    if (this.pendingPlayedGame) this.finishQuickTag(true);

    this.playSound('undo');
    try {
      const res = await API.undoSwipe();
      if (!res.success || !res.restored_game) {
        this.setStatus('Nothing left to undo.');
        return;
      }

      const game = res.restored_game;
      this.applyStatDelta(res.undone_action, -1, game.release_year);

      if (this.mode === 'deck' && !this.matchesFilter(game)) {
        this.setStatus(`Restored "${game.title}" (${game.release_year}) - switch to that year to see it.`);
      } else {
        this.restoreToDeck(game);
        this.setStatus(`Restored "${game.title}".`);
      }
    } catch (err) {
      this.setStatus(`Undo failed: ${err.message}`, true);
    }
  }

  // =========================================================================
  // Inspector (desktop right pane)
  // =========================================================================
  updateInspector(game) {
    const inspector = $('desktop-inspector');

    if (!game) {
      inspector.replaceChildren();
      return;
    }

    const { frag, r } = clone('tpl-inspector');
    const d = displayFields(game);

    r.headerTitle.textContent = `Inspector: ${game.title}`;
    r.headerYear.textContent = d.year;
    r.title.textContent = game.title;
    r.platforms.textContent = d.platforms;
    r.rating.textContent = d.rating;
    r.summary.textContent = game.summary || 'No description available for this title.';
    r.genres.textContent = d.genres;
    r.community.textContent = `${d.rating} (${game.total_rating_count || 0} reviews)`;

    const links = gameLinks(game.title);
    r.steam.href = links.steam;
    r.gog.href = links.gog;
    r.google.href = links.google;

    const shots = game.screenshots || [];
    if (shots.length) {
      r.shotsWrap.hidden = false;
      shots.forEach((src, i) => {
        const img = document.createElement('img');
        img.src = src;
        img.alt = `${game.title} screenshot ${i + 1}`;
        img.dataset.idx = i;
        r.shots.appendChild(img);
      });
      r.shots.addEventListener('click', (e) => {
        if (e.target.dataset.idx) {
          this.openViewer(shots, Number(e.target.dataset.idx), game.title);
        }
      });
    }

    inspector.replaceChildren(frag);
  }

  // =========================================================================
  // Add a game directly, without swiping
  // =========================================================================
  openAddGame() {
    this.playSound('click');
    this.addDialog.open();
  }

  /** Called by the dialog once a status is saved. */
  onGameAdded(game, status, previous) {
    this.playSound(status);
    // keep the running totals honest without a full stats round-trip
    if (previous) this.applyStatDelta(previous, -1, game.release_year);
    this.applyStatDelta(status, 1, game.release_year);
    // if it was sitting in the deck, it is no longer unreviewed
    this.dropFromQueue(game.igdb_id);
  }

  /** Remove a game from the current deck queue, if it is there. */
  dropFromQueue(igdbId) {
    const index = this.queue.findIndex(g => g.igdb_id === igdbId);
    if (index === -1) return;

    this.queue.splice(index, 1);
    const card = this.renderedCards[index];
    if (card) {
      card.remove();
      this.renderedCards.splice(index, 1);
      this.topUpStack();
    } else {
      this.restack();
    }
  }

  // =========================================================================
  // Picture viewer
  // =========================================================================
  openViewer(images, index, title) {
    if (!images?.length) return;
    this.playSound('click');
    this.viewerImages = images;
    this.viewerIndex = Math.max(0, Math.min(index, images.length - 1));
    $('viewer-title').textContent = `Windows Picture and Fax Viewer - ${title}`;
    this.showViewerImage();
    $('modal-picture-viewer').classList.add('open');
  }

  navigateViewer(delta) {
    if (!this.viewerImages.length) return;
    const n = this.viewerImages.length;
    this.viewerIndex = (this.viewerIndex + delta + n) % n;
    this.playSound('click');
    this.showViewerImage();
  }

  showViewerImage() {
    const img = $('viewer-img');
    img.src = this.viewerImages[this.viewerIndex];
    img.alt = `Screenshot ${this.viewerIndex + 1} of ${this.viewerImages.length}`;
    $('viewer-counter').textContent = `${this.viewerIndex + 1} / ${this.viewerImages.length}`;
  }

  // =========================================================================
  // Stats & progress
  // =========================================================================
  async refreshStats() {
    try {
      this.stats = await API.getStats();
      this.updateProgress();
    } catch (err) {
      console.error('Stats refresh failed:', err);
    }
  }

  /**
   * Adjust the cached counts in place. Stats used to be re-fetched after every
   * single swipe - a full GROUP BY over the cache plus a table re-render, per
   * card. The server is re-consulted when the stats dialog opens.
   */
  /** Whether a game would appear under the active deck filter. */
  matchesFilter(game) {
    const { yearFrom, yearTo, genre, minRatings } = this.filter;
    if (yearFrom != null && !(game.release_year >= yearFrom && game.release_year <= yearTo)) return false;
    if (genre && !(game.genres || '').split(',').map(g => g.trim()).includes(genre)) return false;
    if (minRatings > 0 && (game.total_rating_count || 0) < minRatings) return false;
    return true;
  }

  applyStatDelta(status, delta, releaseYear) {
    if (!this.stats) return;
    this.stats.status_counts[status] = (this.stats.status_counts[status] || 0) + delta;
    this.stats.total_swipes += delta;

    // Credit the game's own year, not the selected one - a search result can
    // come from any year, and crediting the deck's year would skew its bar.
    const year = this.stats.years[releaseYear];
    if (year) {
      year.total_swiped += delta;
      year[status] = (year[status] || 0) + delta;
    }
    this.updateProgress();
  }

  /**
   * Progress is measured against how many games IGDB lists for the year, so
   * the denominator is fixed. It falls back to the local cache size when the
   * total is not known yet (no credentials, or the count call failed) - that
   * denominator grows as pages are fetched, which is why it is only a
   * fallback.
   */
  updateProgress() {
    // Counted against everything IGDB has for this filter, so the denominator
    // is fixed. Falls back to the local cache size when the total is unknown
    // (no credentials, or the count request failed) - that one does grow as
    // pages arrive, which is why it is only a fallback.
    const known = this.mode === 'deck' && this.filterTotal;
    const done = this.reviewed;
    const total = known ? this.filterTotal : this.cached;
    const pct = total ? Math.min(100, (done / total) * 100) : 0;

    $('xp-progress-bar').style.width = `${pct}%`;
    $('xp-progress-badge').textContent =
      `${done.toLocaleString()} / ${total.toLocaleString()}`;

    const bar = $('xp-progress');
    bar.setAttribute('aria-valuenow', Math.round(pct));
    bar.setAttribute('aria-valuetext', `${done} of ${total} games reviewed`);
    bar.parentElement.title = known
      ? `${done.toLocaleString()} of the ${total.toLocaleString()} games IGDB has for ${this.describeFilter()}`
      : `${done.toLocaleString()} of ${total.toLocaleString()} games cached locally`;
  }

  renderStatsModal() {
    const counts = this.stats?.status_counts || {};
    $('stat-played-count').textContent = counts.played || 0;
    $('stat-backlog-count').textContent = counts.backlog || 0;
    $('stat-skipped-count').textContent = counts.skipped || 0;
    $('stat-total-count').textContent = this.stats?.total_swipes || 0;

    const body = $('stats-table-body');
    body.replaceChildren();
    Object.values(this.stats?.years || {})
      .sort((a, b) => b.year - a.year)
      .forEach(y => {
        const { frag, r } = clone('tpl-stats-row');
        r.year.textContent = y.year;
        r.played.textContent = y.played;
        r.backlog.textContent = y.backlog;
        r.skipped.textContent = y.skipped;
        r.cached.textContent = y.total_cached;
        r.pct.textContent = `${y.percentage_reviewed}%`;
        body.appendChild(frag);
      });
  }

  setStatus(message, isError = false) {
    const el = $('status-message');
    el.textContent = message;
    el.classList.toggle('status-error', isError);
  }

  // =========================================================================
  // Danger zone
  // =========================================================================
  showDangerConfirm(scope) {
    const labels = {
      year: `every swipe for ${this.filter.yearFrom ?? 'the current scope'}`,
      all_swipes: 'all swipe records across every year',
      factory: 'everything - swipes, cached games and settings'
    };
    this.pendingResetScope = scope;
    this.playSound('click');

    $('danger-scope-desc').textContent = labels[scope];
    $('danger-menu').hidden = true;
    $('danger-confirm').hidden = false;
    $('btn-danger-confirm').hidden = false;
    $('btn-danger-cancel').hidden = false;
    $('btn-danger-close').hidden = true;
  }

  resetDangerPanel() {
    this.pendingResetScope = null;
    $('danger-menu').hidden = false;
    $('danger-confirm').hidden = true;
    $('btn-danger-confirm').hidden = true;
    $('btn-danger-cancel').hidden = true;
    $('btn-danger-close').hidden = false;
  }

  async executeReset() {
    const scope = this.pendingResetScope;
    if (!scope) return;

    try {
      await API.resetData(scope, scope === 'year' ? this.filter.yearFrom : null);
      this.playSound('played');
      this.closeModals();
      await this.refreshStats();
      await this.loadDeck();
      this.setStatus('Reset complete.');
    } catch (err) {
      this.setStatus(`Reset failed: ${err.message}`, true);
    }
  }

  // =========================================================================
  // Modals & menus
  // =========================================================================
  openModal(id) {
    this.playSound('click');
    $(id).classList.add('open');
  }

  closeModals() {
    document.querySelectorAll('.xp-modal-overlay.open').forEach(m => m.classList.remove('open'));
    this.resetDangerPanel();
  }

  /** Escape: cancel the quick-tag details, then close whatever is open. */
  handleEscape() {
    if (this.quickTagActive) {
      this.finishQuickTag(false);
      this.setStatus('Quick-tag dismissed; game kept as played.');
      return;
    }
    this.closeModals();
  }

  initModals() {
    document.querySelectorAll('.modal-close').forEach(btn =>
      btn.addEventListener('click', () => this.closeModals()));

    document.querySelectorAll('.xp-modal-overlay').forEach(overlay =>
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) this.closeModals();
      }));
  }

  initMenu() {
    const items = document.querySelectorAll('.xp-menu-item');
    const closeAll = () => items.forEach(m => {
      m.classList.remove('active');
      m.setAttribute('aria-expanded', 'false');
    });

    items.forEach(item => {
      const toggle = (e) => {
        e.stopPropagation();
        const wasOpen = item.classList.contains('active');
        closeAll();
        if (!wasOpen) {
          item.classList.add('active');
          item.setAttribute('aria-expanded', 'true');
        }
      };
      item.addEventListener('click', toggle);
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); }
      });
    });
    window.addEventListener('click', closeAll);

    const menu = {
      'menu-add-game': () => this.openAddGame(),
      'menu-steam': () => { this.playSound('click'); this.steamDialog.open(); },
      'menu-catalog': () => { window.location.href = '/catalog'; },
      'menu-export': () => this.openModal('modal-export'),
      'menu-danger': () => this.openModal('modal-danger'),
      'menu-reload': () => window.location.reload(),
      'menu-stats': () => { this.refreshStats().then(() => this.renderStatsModal()); this.openModal('modal-stats'); },
      'menu-connect-mobile': () => this.openMobileModal(),
      'menu-sound-toggle': () => this.toggleSound(),
      'menu-setup': () => this.openSetup(),
      'menu-options': () => this.openPreferences(),
      'menu-shortcuts': () => this.openModal('modal-shortcuts'),
      'menu-about': () => this.openModal('modal-about')
    };

    for (const [id, handler] of Object.entries(menu)) {
      const el = $(id);
      el.addEventListener('click', handler);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); }
      });
    }
  }

  async openMobileModal() {
    this.openModal('modal-mobile');
    try {
      const { lan_url } = await API.getNetworkInfo();
      $('mobile-lan-url').textContent = lan_url;
      $('mobile-lan-link').href = lan_url;
      // generated by the backend, so the address never leaves this machine
      $('mobile-qr-img').src = '/api/qr';
    } catch (err) {
      $('mobile-lan-url').textContent = `Unavailable: ${err.message}`;
    }
  }

  // =========================================================================
  // Controls
  // =========================================================================
  initControls() {
    const on = (id, event, handler) => $(id).addEventListener(event, handler);

    on('btn-skip', 'click', () => this.handleSwipeAction('skipped'));
    on('btn-backlog', 'click', () => this.handleSwipeAction('backlog'));
    on('btn-played', 'click', () => this.handleSwipeAction('played'));
    on('btn-flip', 'click', () => this.flipTopCard());
    on('btn-undo', 'click', () => this.undoLastSwipe());

    on('sound-toggle-btn', 'click', () => this.toggleSound());

    on('btn-add-game', 'click', () => this.openAddGame());
    on('deck-search-form', 'submit', (e) => {
      e.preventDefault();
      $('deck-search').blur();
      this.runSearch($('deck-search').value);
    });

    on('empty-load-more-btn', 'click', () => this.loadMore());
    on('empty-next-year-btn', 'click', () => this.advanceScope());

    on('btn-filters', 'click', () => this.openFilters());
    on('btn-filters-apply', 'click', () => this.applyFilters());
    on('btn-filters-reset', 'click', () => this.resetFilters());
    $('filter-min-ratings').addEventListener('input', () => this.updateRatingsHint());
    $('filter-sort').addEventListener('change', () => this.updateRatingsHint());
    on('empty-setup-btn', 'click', () => this.openSetup());

    on('viewer-prev', 'click', () => this.navigateViewer(-1));
    on('viewer-next', 'click', () => this.navigateViewer(1));

    // one delegated listener instead of ten
    document.querySelector('.quicktag-rating-buttons').addEventListener('click', (e) => {
      const btn = e.target.closest('.rating-btn');
      if (btn) this.setQuickRating(Number(btn.dataset.val));
    });
    on('btn-quicktag-save', 'click', () => this.finishQuickTag(true));
    on('btn-quicktag-discard', 'click', () => this.finishQuickTag(false));

    const duration = $('setting-rating-duration');
    const quickTag = $('setting-quicktag-enabled');
    duration.addEventListener('input', (e) => this.updateDurationLabel(Number(e.target.value)));
    quickTag.addEventListener('change', (e) => this.updateQuickTagToggleUI(e.target.checked));

    on('btn-save-settings', 'click', () => {
      this.saveSettings(Number(duration.value), quickTag.checked);
      this.closeModals();
    });

    $('danger-menu').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-scope]');
      if (btn) this.showDangerConfirm(btn.dataset.scope);
    });
    on('setup-save-btn', 'click', () => this.saveSetup());
    on('setup-skip-btn', 'click', () => this.closeModals());
    on('setup-client-secret', 'keydown', (e) => { if (e.key === 'Enter') this.saveSetup(); });
    on('setup-client-id', 'keydown', (e) => { if (e.key === 'Enter') $('setup-client-secret').focus(); });

    on('btn-danger-confirm', 'click', () => this.executeReset());
    on('btn-danger-cancel', 'click', () => this.resetDangerPanel());
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new XPDeckApp();
});

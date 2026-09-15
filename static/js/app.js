/**
 * APP.JS: XP-Deck Application Coordinator & State Manager
 * Enhanced with Desktop Inspector, In-Page Picture Viewer, Catalog Explorer,
 * Danger Zone, Configurable Rating Duration, and End-of-Year Progression.
 */

class XPDeckApp {
  constructor() {
    this.currentYear = 2004;
    this.currentOffset = 0;
    this.queue = [];
    this.renderedCards = [];
    this.stats = null;
    this.soundEnabled = true;

    // Configurable Rating Duration (default 10s)
    this.ratingDurationSeconds = 10;
    this.quickTagActive = false;
    this.quickTagTimer = null;
    this.pendingPlayedGame = null;
    this.selectedRating = null;

    // Picture Viewer State
    this.currentViewerImages = [];
    this.currentViewerIndex = 0;

    // Audio & API
    this.audioCtx = null;

    this.init();
  }

  async init() {
    this.initAudio();
    this.initYearSelector();
    this.initMenu();
    this.initGestures();
    this.initShortcuts();
    this.initControls();
    this.initModals();

    // Load user settings from backend / local cache
    await this.loadSettings();

    // Refresh stats and load initial year
    await this.refreshStats();
    await this.loadYear(this.currentYear);
  }

  // =========================================================================
  // User Settings (Adjustable & Persisted Rating Duration)
  // =========================================================================
  async loadSettings() {
    try {
      const data = await API.getSettings();
      if (data && data.rating_duration_seconds !== undefined) {
        this.ratingDurationSeconds = parseInt(data.rating_duration_seconds, 10);
      }
    } catch (e) {
      const cached = localStorage.getItem('xp_rating_duration');
      if (cached !== null) {
        this.ratingDurationSeconds = parseInt(cached, 10);
      }
    }

    const input = document.getElementById('setting-rating-duration');
    const label = document.getElementById('setting-duration-label');
    if (input) input.value = this.ratingDurationSeconds;
    if (label) {
      label.textContent = this.ratingDurationSeconds === 0 ? 'Manual / Sticky (No auto-save)' : `${this.ratingDurationSeconds} seconds`;
    }
  }

  async saveSettings(duration) {
    this.ratingDurationSeconds = parseInt(duration, 10);
    localStorage.setItem('xp_rating_duration', this.ratingDurationSeconds.toString());
    try {
      await API.updateSettings(this.ratingDurationSeconds);
      this.setStatus(`Settings saved: Rating duration set to ${this.ratingDurationSeconds}s.`);
    } catch (e) {
      this.setStatus(`Settings saved locally: ${this.ratingDurationSeconds}s.`);
    }
  }

  // =========================================================================
  // Web Audio Synthesizer (No external audio files)
  // =========================================================================
  initAudio() {
    const savedSound = localStorage.getItem('xp_sound_enabled');
    if (savedSound !== null) {
      this.soundEnabled = savedSound === 'true';
    }
    this.updateSoundIcon();

    const unlockAudio = () => {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
          this.audioCtx = new AudioContext();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      window.removeEventListener('pointerdown', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
    };

    window.addEventListener('pointerdown', unlockAudio);
    window.addEventListener('keydown', unlockAudio);
  }

  toggleSound() {
    this.soundEnabled = !this.soundEnabled;
    localStorage.setItem('xp_sound_enabled', this.soundEnabled.toString());
    this.updateSoundIcon();
    if (this.soundEnabled) {
      this.playSound('click');
    }
  }

  updateSoundIcon() {
    const soundBtn = document.getElementById('sound-toggle-btn');
    const statusSound = document.getElementById('status-sound');
    const icon = this.soundEnabled ? XPIcons.speaker : XPIcons.speakerMute;
    const text = this.soundEnabled ? ' Sound: ON' : ' Sound: OFF';
    
    if (soundBtn) soundBtn.innerHTML = `${icon}<span>${text}</span>`;
    if (statusSound) statusSound.innerHTML = `${icon}<span>${text}</span>`;
  }

  playSound(type) {
    if (!this.soundEnabled || !this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;

      if (type === 'click') {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1400, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.04);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.05);
      } else if (type === 'whoosh') {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(350, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.12);
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.14);
      } else if (type === 'ding') {
        [523.25, 659.25, 783.99].forEach((freq, idx) => {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.02);
          gain.gain.setValueAtTime(0.12, now + idx * 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.02 + 0.35);
          osc.connect(gain);
          gain.connect(this.audioCtx.destination);
          osc.start(now + idx * 0.02);
          osc.stop(now + idx * 0.02 + 0.4);
        });
      } else if (type === 'undo') {
        [440, 554.37].forEach((freq, idx) => {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.06);
          gain.gain.setValueAtTime(0.1, now + idx * 0.06);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.06 + 0.2);
          osc.connect(gain);
          gain.connect(this.audioCtx.destination);
          osc.start(now + idx * 0.06);
          osc.stop(now + idx * 0.06 + 0.25);
        });
      }
    } catch (e) {}
  }

  // =========================================================================
  // Year Selector & Progression
  // =========================================================================
  initYearSelector() {
    const select = document.getElementById('year-select');
    if (!select) return;

    select.innerHTML = '';
    const currentYear = new Date().getFullYear();

    for (let y = currentYear; y >= 1980; y--) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = `${y}`;
      select.appendChild(opt);
    }

    select.value = this.currentYear;
    select.addEventListener('change', (e) => {
      this.playSound('click');
      this.loadYear(parseInt(e.target.value, 10));
    });
  }

  async loadYear(year, offset = 0) {
    this.currentYear = year;
    this.currentOffset = offset;

    const select = document.getElementById('year-select');
    if (select && select.value != year) select.value = year;

    this.setStatus(`Loading games for ${year}...`);
    if (offset === 0) {
      this.queue = [];
      this.clearDeckDOM();
    }

    try {
      const data = await API.getDeck(year, 30, offset);
      const newGames = data.games || [];

      if (offset === 0) {
        this.queue = newGames;
      } else {
        const existingIds = new Set(this.queue.map(g => g.igdb_id));
        const filtered = newGames.filter(g => !existingIds.has(g.igdb_id));
        this.queue.push(...filtered);
      }

      this.updateProgressBadge();
      this.renderInitialStack();
      this.setStatus(`Ready. ${this.queue.length} games in queue for ${year}.`);
    } catch (err) {
      console.error(err);
      this.setStatus(`Error loading ${year}. Using cached data.`);
      this.updateProgressBadge();
      this.renderInitialStack();
    }
  }

  loadNextBatchForCurrentYear() {
    this.playSound('click');
    const nextOffset = this.currentOffset + 30;
    this.loadYear(this.currentYear, nextOffset);
  }

  advanceToNextYear() {
    this.playSound('click');
    const nextYear = this.currentYear + 1;
    const maxYear = new Date().getFullYear();
    if (nextYear <= maxYear) {
      this.loadYear(nextYear, 0);
    } else {
      this.loadYear(1980, 0);
    }
  }

  // =========================================================================
  // 5-Card Stack & Desktop Inspector
  // =========================================================================
  clearDeckDOM() {
    const container = document.getElementById('deck-container');
    const existingCards = container.querySelectorAll('.game-card');
    existingCards.forEach(c => c.remove());
    this.renderedCards = [];
  }

  renderInitialStack() {
    const container = document.getElementById('deck-container');
    const emptyState = document.getElementById('deck-empty');

    if (this.queue.length === 0) {
      if (emptyState) {
        emptyState.classList.add('visible');
        document.getElementById('empty-year-name').textContent = this.currentYear;
        document.getElementById('empty-next-year-btn').textContent = `Advance to ${this.currentYear + 1}`;
      }
      if (this.gestures) this.gestures.attachTopCard(null);
      this.updateInspector(null);
      this.updateRemainingCount();
      return;
    }

    if (emptyState) emptyState.classList.remove('visible');

    const initialBatch = this.queue.slice(0, 5);
    initialBatch.forEach((game, index) => {
      const cardEl = this.createCardElement(game, index);
      container.appendChild(cardEl);
      this.renderedCards.push(cardEl);
    });

    if (this.renderedCards.length > 0) {
      this.gestures.attachTopCard(this.renderedCards[0]);
      this.updateInspector(this.queue[0]);
    }
    this.updateRemainingCount();
  }

  createCardElement(game, index) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.dataset.index = index;
    card.dataset.id = game.igdb_id;

    const coverUrl = game.cover_url || 'https://images.igdb.com/igdb/image/upload/t_cover_big/nocover.png';
    const ratingDisplay = game.rating ? `★ ${game.rating}` : '★ Unrated';
    const genresDisplay = game.genres || 'Video Game';
    const platformsDisplay = game.platforms || 'Multiple Platforms';

    // Store search links
    const steamUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(game.title)}`;
    const gogUrl = `https://www.gog.com/en/games?query=${encodeURIComponent(game.title)}`;
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(game.title + ' video game')}`;

    // Screenshots gallery for card back
    let screenshotsHtml = '';
    if (Array.isArray(game.screenshots) && game.screenshots.length > 0) {
      screenshotsHtml = `
        <div class="screenshots-title">${XPIcons.picture} Screenshots Preview:</div>
        <div class="card-back-screenshots">
          ${game.screenshots.map((s, sIdx) => `
            <img class="screenshot-thumb" src="${s}" alt="screenshot" data-sidx="${sIdx}">
          `).join('')}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="stamp-badge stamp-played">PLAYED</div>
      <div class="stamp-badge stamp-skipped">SKIPPED</div>
      <div class="stamp-badge stamp-backlog">BACKLOG</div>

      <div class="card-inner">
        <!-- Front Side -->
        <div class="card-front">
          <img class="card-cover" src="${coverUrl}" alt="${game.title}" loading="lazy" onerror="this.src='https://images.igdb.com/igdb/image/upload/t_cover_big/nocover.png'">
          <div class="card-front-overlay">
            <div class="card-badges-row">
              <span class="card-pill pill-rating">${ratingDisplay}</span>
              <span class="card-pill pill-year">${game.release_year}</span>
              <span class="card-pill pill-genres">${genresDisplay.split(',')[0]}</span>
            </div>
            <h2 class="card-title">${game.title}</h2>
            <div class="card-platforms">${platformsDisplay}</div>
            <div class="card-hint">
              ${XPIcons.flip} <span>Tap card to flip for details</span>
            </div>
          </div>
        </div>

        <!-- Back Side - High Readability -->
        <div class="card-back">
          <div class="card-back-header">
            <span>${XPIcons.floppy} ${game.title} (${game.release_year})</span>
            <span class="card-back-close" title="Flip Back">✕</span>
          </div>
          <div class="card-back-content">
            <div class="card-back-sub">
              ★ ${game.rating || 'Unrated'} • ${genresDisplay.split(',')[0]} • ${platformsDisplay.split(',')[0]}
            </div>

            <!-- Prominent, Large Readable Description -->
            <div class="card-back-summary">
              ${game.summary || 'No detailed description available for this title.'}
            </div>

            <!-- Bottom Action & Store Strip -->
            <div class="card-back-footer">
              <div class="xp-store-buttons" style="border: none; padding: 0;">
                <a href="${steamUrl}" target="_blank" rel="noopener noreferrer" class="xp-button store-btn" style="color: #002244;">
                  ${XPIcons.external} Steam
                </a>
                <a href="${gogUrl}" target="_blank" rel="noopener noreferrer" class="xp-button store-btn" style="color: #4A148C;">
                  ${XPIcons.external} GOG
                </a>
                <a href="${googleUrl}" target="_blank" rel="noopener noreferrer" class="xp-button store-btn">
                  ${XPIcons.search} Google
                </a>
              </div>

              ${Array.isArray(game.screenshots) && game.screenshots.length > 0 ? `
                <button class="xp-button store-btn view-shots-btn" style="color: #003399;">
                  ${XPIcons.picture} Screenshots (${game.screenshots.length})
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      </div>
    `;

    // Click handler for Screenshots button on card back
    const shotsBtn = card.querySelector('.view-shots-btn');
    if (shotsBtn) {
      shotsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.openPictureViewer(game.screenshots, 0, game.title);
      });
    }

    const closeBtn = card.querySelector('.card-back-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.flipTopCard();
      });
    }

    return card;
  }

  // =========================================================================
  // Desktop Inspector Panel (Right Pane on PC)
  // =========================================================================
  updateInspector(game) {
    const inspector = document.getElementById('desktop-inspector');
    if (!inspector) return;

    if (!game) {
      inspector.innerHTML = `
        <div class="xp-inspector-header">
          <span>${XPIcons.info} Live Game Inspector</span>
        </div>
        <div class="xp-inspector-body" style="align-items: center; justify-content: center; text-align: center; color: #777;">
          <p>No active game selected in deck.</p>
        </div>
      `;
      return;
    }

    const ratingDisplay = game.rating ? `★ ${game.rating}` : '★ Unrated';
    const genresDisplay = game.genres || 'Video Game';
    const platformsDisplay = game.platforms || 'Multiple Platforms';

    const steamUrl = `https://store.steampowered.com/search/?term=${encodeURIComponent(game.title)}`;
    const gogUrl = `https://www.gog.com/en/games?query=${encodeURIComponent(game.title)}`;
    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(game.title + ' video game')}`;

    let screenshotsMarkup = '';
    if (Array.isArray(game.screenshots) && game.screenshots.length > 0) {
      screenshotsMarkup = `
        <div>
          <div style="font-weight: bold; font-size: 11px; margin-bottom: 6px;">
            ${XPIcons.picture} Screenshots Gallery (Click to view full size):
          </div>
          <div class="xp-inspector-screenshots">
            ${game.screenshots.map((s, idx) => `
              <img src="${s}" alt="screenshot" data-sidx="${idx}" class="inspector-thumb">
            `).join('')}
          </div>
        </div>
      `;
    }

    inspector.innerHTML = `
      <div class="xp-inspector-header">
        <span>${XPIcons.gamepad} Live Inspector: ${game.title}</span>
        <span style="font-size: 11px; opacity: 0.85;">${game.release_year}</span>
      </div>
      <div class="xp-inspector-body">
        <div class="xp-inspector-title-row">
          <div>
            <div class="xp-inspector-title">${game.title}</div>
            <div style="font-size: 11px; color: #555; margin-top: 2px;">
              ${platformsDisplay}
            </div>
          </div>
          <span class="card-pill pill-rating" style="font-size: 12px;">${ratingDisplay}</span>
        </div>

        <!-- External Store & Search Links -->
        <div class="xp-store-buttons">
          <span style="font-size: 11px; font-weight: bold; margin-right: 4px; align-self: center;">Game Links:</span>
          <a href="${steamUrl}" target="_blank" rel="noopener noreferrer" class="xp-button store-btn" style="color: #002244;">
            ${XPIcons.external} Search Steam
          </a>
          <a href="${gogUrl}" target="_blank" rel="noopener noreferrer" class="xp-button store-btn" style="color: #4A148C;">
            ${XPIcons.external} Search GOG
          </a>
          <a href="${googleUrl}" target="_blank" rel="noopener noreferrer" class="xp-button store-btn">
            ${XPIcons.search} Google Search
          </a>
        </div>

        <!-- Clear, High-Contrast Description -->
        <div>
          <div style="font-weight: bold; font-size: 11px; margin-bottom: 4px;">Game Synopsis:</div>
          <div class="xp-inspector-desc-box">
            ${game.summary || 'No detailed description available for this title.'}
          </div>
        </div>

        <div class="xp-inspector-meta">
          <div class="meta-box">
            <strong>Genres:</strong>
            <span>${genresDisplay}</span>
          </div>
          <div class="meta-box">
            <strong>IGDB Community Rating:</strong>
            <span>${ratingDisplay} (${game.total_rating_count || 0} reviews)</span>
          </div>
        </div>

        ${screenshotsMarkup}
      </div>
    `;

    // Attach click listeners to inspector thumbnails
    const thumbs = inspector.querySelectorAll('.inspector-thumb');
    thumbs.forEach(t => {
      t.addEventListener('click', () => {
        const sIdx = parseInt(t.dataset.sidx, 10) || 0;
        this.openPictureViewer(game.screenshots, sIdx, game.title);
      });
    });
  }

  // =========================================================================
  // In-Page Windows Picture and Fax Viewer Modal
  // =========================================================================
  openPictureViewer(screenshots, initialIndex = 0, title = 'Screenshot') {
    if (!screenshots || screenshots.length === 0) return;
    this.playSound('click');

    this.currentViewerImages = screenshots;
    this.currentViewerIndex = Math.max(0, Math.min(initialIndex, screenshots.length - 1));

    const modal = document.getElementById('modal-picture-viewer');
    const titleEl = document.getElementById('viewer-title');
    const imgEl = document.getElementById('viewer-img');
    const counterEl = document.getElementById('viewer-counter');

    if (titleEl) titleEl.textContent = `Windows Picture and Fax Viewer - ${title}`;
    if (imgEl) imgEl.src = this.currentViewerImages[this.currentViewerIndex];
    if (counterEl) counterEl.textContent = `${this.currentViewerIndex + 1} / ${this.currentViewerImages.length}`;

    if (modal) modal.classList.add('open');
  }

  navigateViewer(delta) {
    if (!this.currentViewerImages || this.currentViewerImages.length === 0) return;
    this.playSound('click');

    this.currentViewerIndex = (this.currentViewerIndex + delta + this.currentViewerImages.length) % this.currentViewerImages.length;
    const imgEl = document.getElementById('viewer-img');
    const counterEl = document.getElementById('viewer-counter');

    if (imgEl) imgEl.src = this.currentViewerImages[this.currentViewerIndex];
    if (counterEl) counterEl.textContent = `${this.currentViewerIndex + 1} / ${this.currentViewerImages.length}`;
  }

  // =========================================================================
  // Swiping & Gestures
  // =========================================================================
  initGestures() {
    const container = document.getElementById('deck-container');
    this.gestures = new CardGestures(
      container,
      (card, action) => this.onCardSwiped(card, action),
      (card) => this.onCardFlipped(card)
    );
  }

  onCardFlipped(card) {
    this.playSound('click');
    card.classList.toggle('flipped');
  }

  flipTopCard() {
    if (this.renderedCards.length > 0) {
      this.onCardFlipped(this.renderedCards[0]);
    }
  }

  handleSwipeAction(action) {
    if (this.renderedCards.length === 0) return;
    this.gestures.triggerAction(action);
  }

  onCardSwiped(cardEl, action) {
    this.playSound(action === 'played' ? 'ding' : 'whoosh');

    const swipedGame = this.queue.shift();
    this.renderedCards.shift();

    if (action === 'played' && swipedGame) {
      this.openQuickTag(swipedGame);
    } else if (swipedGame) {
      this.commitSwipe(swipedGame.igdb_id, action);
    }

    setTimeout(() => {
      cardEl.remove();
      this.shiftDeckStack();
    }, 250);
  }

  shiftDeckStack() {
    const container = document.getElementById('deck-container');

    this.renderedCards.forEach((card, idx) => {
      card.dataset.index = idx;
    });

    if (this.queue.length >= this.renderedCards.length && this.renderedCards.length < 5) {
      const nextGameIndex = this.renderedCards.length;
      const nextGame = this.queue[nextGameIndex];
      if (nextGame) {
        const newCard = this.createCardElement(nextGame, this.renderedCards.length);
        container.appendChild(newCard);
        this.renderedCards.push(newCard);
      }
    }

    if (this.renderedCards.length > 0) {
      this.gestures.attachTopCard(this.renderedCards[0]);
      this.updateInspector(this.queue[0]);
    } else {
      this.gestures.attachTopCard(null);
      this.updateInspector(null);
      const emptyState = document.getElementById('deck-empty');
      if (emptyState) {
        emptyState.classList.add('visible');
        document.getElementById('empty-year-name').textContent = this.currentYear;
        document.getElementById('empty-next-year-btn').textContent = `Advance to ${this.currentYear + 1}`;
      }
    }

    this.updateRemainingCount();
  }

  async commitSwipe(igdbId, status, platform = null, hours = null, rating = null) {
    try {
      await API.recordSwipe(igdbId, status, platform, hours, rating);
      await this.refreshStats();
    } catch (err) {
      console.error('Error saving swipe:', err);
      this.setStatus('Error saving swipe to database.');
    }
  }

  // =========================================================================
  // Quick-Tag Popover with Adjustable & Persisted Duration
  // =========================================================================
  openQuickTag(game) {
    if (this.pendingPlayedGame) {
      this.savePendingQuickTag();
    }

    this.pendingPlayedGame = game;
    this.selectedRating = null;
    this.quickTagActive = true;

    const popover = document.getElementById('quicktag-popover');
    const titleEl = document.getElementById('quicktag-title');
    const timerTextEl = document.getElementById('quicktag-timer');
    const platformSelect = document.getElementById('quicktag-platform');
    const fillEl = document.getElementById('quicktag-timer-fill');

    if (!popover) return;
    if (titleEl) titleEl.textContent = `Tagged: ${game.title}`;

    // Populate platform options
    if (platformSelect) {
      platformSelect.innerHTML = '<option value="">(Select Platform)</option>';
      if (game.platforms) {
        const list = game.platforms.split(',').map(p => p.trim());
        list.forEach(p => {
          const opt = document.createElement('option');
          opt.value = p;
          opt.textContent = p;
          platformSelect.appendChild(opt);
        });
        if (list.length > 0) platformSelect.value = list[0];
      }
    }

    const ratingBtns = popover.querySelectorAll('.rating-btn');
    ratingBtns.forEach(b => b.classList.remove('active'));

    popover.classList.add('visible');

    if (this.quickTagTimer) clearTimeout(this.quickTagTimer);

    // If duration is 0, operate in manual mode (never auto-saves without user action)
    if (this.ratingDurationSeconds <= 0) {
      if (timerTextEl) timerTextEl.textContent = 'Manual mode (Click Save when done)';
      if (fillEl) fillEl.style.width = '100%';
    } else {
      const durSec = this.ratingDurationSeconds;
      if (timerTextEl) timerTextEl.textContent = `Auto-saving in ${durSec}s...`;

      if (fillEl) {
        fillEl.style.transition = 'none';
        fillEl.style.width = '100%';
        void fillEl.offsetWidth;
        fillEl.style.transition = `width ${durSec}s linear`;
        fillEl.style.width = '0%';
      }

      this.quickTagTimer = setTimeout(() => {
        this.savePendingQuickTag();
      }, durSec * 1000);
    }
  }

  setQuickRating(rating) {
    this.selectedRating = rating;
    const popover = document.getElementById('quicktag-popover');
    if (!popover) return;
    const ratingBtns = popover.querySelectorAll('.rating-btn');
    ratingBtns.forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.val, 10) === rating);
    });

    // Reset countdown slightly if in timed mode
    if (this.ratingDurationSeconds > 0) {
      if (this.quickTagTimer) clearTimeout(this.quickTagTimer);
      const remainingSec = Math.min(this.ratingDurationSeconds, 4);
      const fillEl = document.getElementById('quicktag-timer-fill');
      const timerTextEl = document.getElementById('quicktag-timer');

      if (timerTextEl) timerTextEl.textContent = `Auto-saving in ${remainingSec}s...`;
      if (fillEl) {
        fillEl.style.transition = 'none';
        fillEl.style.width = '100%';
        void fillEl.offsetWidth;
        fillEl.style.transition = `width ${remainingSec}s linear`;
        fillEl.style.width = '0%';
      }
      this.quickTagTimer = setTimeout(() => {
        this.savePendingQuickTag();
      }, remainingSec * 1000);
    }
  }

  savePendingQuickTag() {
    if (!this.pendingPlayedGame) return;

    if (this.quickTagTimer) {
      clearTimeout(this.quickTagTimer);
      this.quickTagTimer = null;
    }

    const platformSelect = document.getElementById('quicktag-platform');
    const hoursInput = document.getElementById('quicktag-hours');
    const popover = document.getElementById('quicktag-popover');

    const platform = platformSelect ? platformSelect.value : null;
    const hours = hoursInput && hoursInput.value ? parseInt(hoursInput.value, 10) : null;
    const rating = this.selectedRating;

    this.commitSwipe(this.pendingPlayedGame.igdb_id, 'played', platform, hours, rating);

    this.pendingPlayedGame = null;
    this.quickTagActive = false;
    if (popover) popover.classList.remove('visible');
    if (hoursInput) hoursInput.value = '';
  }

  // =========================================================================
  // Undo Stack
  // =========================================================================
  async undoLastSwipe() {
    this.playSound('undo');
    this.setStatus('Undoing last swipe...');

    try {
      const res = await API.undoSwipe();
      if (!res.success || !res.restored_game) {
        this.setStatus('No recent swipe to undo.');
        return;
      }

      const restoredGame = res.restored_game;
      this.setStatus(`Restored "${restoredGame.title}".`);

      if (restoredGame.release_year === this.currentYear) {
        this.queue.unshift(restoredGame);

        const container = document.getElementById('deck-container');
        const emptyState = document.getElementById('deck-empty');
        if (emptyState) emptyState.classList.remove('visible');

        const newCard = this.createCardElement(restoredGame, 0);
        newCard.style.opacity = '0';
        newCard.style.transform = 'translateY(-30px) scale(0.9)';
        container.insertBefore(newCard, container.firstChild);
        this.renderedCards.unshift(newCard);

        void newCard.offsetWidth;
        newCard.style.transition = 'all 0.3s cubic-bezier(0.2, 0.9, 0.3, 1)';
        newCard.style.opacity = '1';
        newCard.style.transform = 'translateY(0) scale(1)';

        this.renderedCards.forEach((c, idx) => c.dataset.index = idx);
        this.gestures.attachTopCard(this.renderedCards[0]);
        this.updateInspector(this.renderedCards[0]);
        this.updateRemainingCount();
      } else {
        this.setStatus(`Restored "${restoredGame.title}" (${restoredGame.release_year}).`);
      }

      await this.refreshStats();
    } catch (err) {
      console.error(err);
      this.setStatus('Undo failed.');
    }
  }

  // =========================================================================
  // Catalog Archive Explorer (View, Search, In-Place Edit, Unswipe)
  // =========================================================================
  async openCatalogModal(filterStatus = 'all') {
    this.playSound('click');
    const modal = document.getElementById('modal-catalog');
    if (!modal) return;

    // Set active tab
    const tabs = modal.querySelectorAll('.catalog-tab');
    tabs.forEach(t => {
      t.classList.toggle('active', t.dataset.status === filterStatus);
    });

    modal.classList.add('open');
    await this.refreshCatalogList();
  }

  async refreshCatalogList() {
    const modal = document.getElementById('modal-catalog');
    if (!modal) return;

    const activeTab = modal.querySelector('.catalog-tab.active');
    const status = activeTab ? activeTab.dataset.status : 'all';
    const search = document.getElementById('catalog-search')?.value || '';
    const sort = document.getElementById('catalog-sort')?.value || 'date_desc';

    const tbody = document.getElementById('catalog-tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px;">Loading catalog...</td></tr>`;

    try {
      const data = await API.getCatalog(status, search, sort);
      const games = data.games || [];

      if (tbody) {
        if (games.length === 0) {
          tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #666;">No games match your criteria.</td></tr>`;
          return;
        }

        tbody.innerHTML = '';
        games.forEach(g => {
          const tr = document.createElement('tr');
          const cover = g.cover_url || 'https://images.igdb.com/igdb/image/upload/t_cover_big/nocover.png';
          const ratingVal = g.user_rating ? `${g.user_rating}/10` : '-';
          const hoursVal = g.hours_played ? `${g.hours_played}h` : '-';

          tr.innerHTML = `
            <td style="width: 44px; text-align: center;">
              <img src="${cover}" alt="cover" style="width: 32px; height: 42px; object-fit: cover; border: 1px solid #999;">
            </td>
            <td>
              <div style="font-weight: bold; color: #003399;">${g.title}</div>
              <div style="font-size: 10px; color: #666;">${g.genres || ''}</div>
            </td>
            <td style="text-align: center;">${g.release_year}</td>
            <td style="text-align: center;"><span class="status-pill ${g.status}">${g.status}</span></td>
            <td style="text-align: center; font-weight: bold;">${ratingVal}</td>
            <td style="text-align: center;">${hoursVal}</td>
            <td style="text-align: right; white-space: nowrap;">
              <button class="xp-button edit-btn" style="padding: 2px 6px; font-size: 11px;">Edit</button>
            </td>
          `;

          // Edit Drawer Toggle
          const editBtn = tr.querySelector('.edit-btn');
          editBtn.addEventListener('click', () => {
            this.toggleCatalogEditRow(tr, g);
          });

          tbody.appendChild(tr);
        });
      }
    } catch (e) {
      console.error(e);
      if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 20px; color: red;">Failed to load catalog.</td></tr>`;
    }
  }

  toggleCatalogEditRow(parentRow, game) {
    const existingDrawer = parentRow.nextElementSibling;
    if (existingDrawer && existingDrawer.classList.contains('drawer-row')) {
      existingDrawer.remove();
      return;
    }

    const drawerRow = document.createElement('tr');
    drawerRow.className = 'drawer-row';

    drawerRow.innerHTML = `
      <td colspan="7" style="padding: 0; background: #FAF9F5;">
        <div class="catalog-edit-drawer">
          <div style="display: flex; flex-direction: column; gap: 2px;">
            <label style="font-size: 10px; font-weight: bold;">Status:</label>
            <select class="xp-select edit-status">
              <option value="played" ${game.status === 'played' ? 'selected' : ''}>Played</option>
              <option value="backlog" ${game.status === 'backlog' ? 'selected' : ''}>Backlog</option>
              <option value="skipped" ${game.status === 'skipped' ? 'selected' : ''}>Skipped</option>
            </select>
          </div>

          <div style="display: flex; flex-direction: column; gap: 2px;">
            <label style="font-size: 10px; font-weight: bold;">User Rating (1-10):</label>
            <input type="number" class="xp-select edit-rating" min="1" max="10" value="${game.user_rating || ''}" style="width: 60px;">
          </div>

          <div style="display: flex; flex-direction: column; gap: 2px;">
            <label style="font-size: 10px; font-weight: bold;">Platform:</label>
            <input type="text" class="xp-select edit-platform" value="${game.platform_played || ''}" placeholder="e.g. PC, PS2" style="width: 110px;">
          </div>

          <div style="display: flex; flex-direction: column; gap: 2px;">
            <label style="font-size: 10px; font-weight: bold;">Hours Played:</label>
            <input type="number" class="xp-select edit-hours" min="0" value="${game.hours_played || ''}" placeholder="0" style="width: 60px;">
          </div>

          <div style="display: flex; gap: 6px; margin-left: auto; align-items: flex-end;">
            <button class="xp-button xp-button-green save-drawer-btn" style="padding: 4px 10px;">
              ${XPIcons.check} Save
            </button>
            <button class="xp-button xp-button-red delete-drawer-btn" style="padding: 4px 10px;" title="Unswipe game and return to deck">
              ${XPIcons.trash} Unswipe
            </button>
          </div>
        </div>
      </td>
    `;

    parentRow.after(drawerRow);

    // Save button
    drawerRow.querySelector('.save-drawer-btn').addEventListener('click', async () => {
      const status = drawerRow.querySelector('.edit-status').value;
      const rating = drawerRow.querySelector('.edit-rating').value;
      const platform = drawerRow.querySelector('.edit-platform').value;
      const hours = drawerRow.querySelector('.edit-hours').value;

      try {
        await API.updateCatalogItem(game.igdb_id, {
          status,
          user_rating: rating ? parseInt(rating, 10) : null,
          platform_played: platform || null,
          hours_played: hours ? parseInt(hours, 10) : null
        });
        this.playSound('ding');
        await this.refreshCatalogList();
        await this.refreshStats();
      } catch (e) {
        alert('Failed to update game: ' + e.message);
      }
    });

    // Delete (Unswipe) button
    drawerRow.querySelector('.delete-drawer-btn').addEventListener('click', async () => {
      if (confirm(`Unswipe "${game.title}"? It will be removed from your catalog and returned to the review pool.`)) {
        try {
          await API.deleteCatalogItem(game.igdb_id);
          this.playSound('whoosh');
          await this.refreshCatalogList();
          await this.refreshStats();
          // Reload current year to make restored game immediately visible if applicable
          if (game.release_year === this.currentYear) {
            await this.loadYear(this.currentYear);
          }
        } catch (e) {
          alert('Failed to unswipe game: ' + e.message);
        }
      }
    });
  }

  // =========================================================================
  // Danger Zone
  // =========================================================================
  async executeReset(scope) {
    let confirmMsg = '';
    if (scope === 'year') {
      confirmMsg = `Are you sure you want to reset all swipes for ${this.currentYear}? This action cannot be undone.`;
    } else if (scope === 'all_swipes') {
      confirmMsg = `WARNING: This will clear ALL your swiped history across all years! Your cached games will remain intact. Proceed?`;
    } else if (scope === 'factory') {
      confirmMsg = `DANGER: Full Factory Reset! This wipes the database completely and re-initializes defaults. Are you absolutely sure?`;
    }

    if (!confirm(confirmMsg)) return;

    this.playSound('click');
    try {
      await API.resetData(scope, this.currentYear);
      alert('Reset complete.');
      this.closeModalsAndPopovers();
      await this.refreshStats();
      await this.loadYear(this.currentYear);
    } catch (e) {
      alert('Reset error: ' + e.message);
    }
  }

  // =========================================================================
  // Stats & Progress Bar
  // =========================================================================
  async refreshStats() {
    try {
      this.stats = await API.getStats();
      this.updateProgressBadge();
      this.renderStatsModal();
    } catch (e) {
      console.error('Error refreshing stats:', e);
    }
  }

  updateProgressBadge() {
    if (!this.stats || !this.stats.years) return;
    const yearData = this.stats.years[this.currentYear];
    const pct = yearData ? yearData.percentage_reviewed : 0;

    const bar = document.getElementById('xp-progress-bar');
    const badge = document.getElementById('xp-progress-badge');

    if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (badge) badge.textContent = `${pct}%`;
  }

  updateRemainingCount() {
    const queueCountEl = document.getElementById('status-queue');
    if (queueCountEl) {
      queueCountEl.textContent = `Cards Left: ${this.queue.length}`;
    }
  }

  setStatus(msg) {
    const statusEl = document.getElementById('status-message');
    if (statusEl) statusEl.textContent = msg;
  }

  // =========================================================================
  // Controls & Listeners
  // =========================================================================
  initControls() {
    document.getElementById('btn-skip')?.addEventListener('click', () => {
      this.handleSwipeAction('skipped');
    });

    document.getElementById('btn-backlog')?.addEventListener('click', () => {
      this.handleSwipeAction('backlog');
    });

    document.getElementById('btn-flip')?.addEventListener('click', () => {
      this.flipTopCard();
    });

    document.getElementById('btn-played')?.addEventListener('click', () => {
      this.handleSwipeAction('played');
    });

    document.getElementById('btn-undo')?.addEventListener('click', () => {
      this.undoLastSwipe();
    });

    // Quicktag buttons
    const ratingBtns = document.querySelectorAll('.rating-btn');
    ratingBtns.forEach(b => {
      b.addEventListener('click', (e) => {
        const val = parseInt(e.target.dataset.val, 10);
        this.setQuickRating(val);
      });
    });

    document.getElementById('btn-quicktag-save')?.addEventListener('click', () => {
      this.savePendingQuickTag();
    });

    // End-of-year continuation buttons
    document.getElementById('empty-load-more-btn')?.addEventListener('click', () => {
      this.loadNextBatchForCurrentYear();
    });

    document.getElementById('empty-next-year-btn')?.addEventListener('click', () => {
      this.advanceToNextYear();
    });

    // Picture viewer controls
    document.getElementById('viewer-prev')?.addEventListener('click', () => this.navigateViewer(-1));
    document.getElementById('viewer-next')?.addEventListener('click', () => this.navigateViewer(1));

    // Catalog controls
    document.querySelectorAll('.catalog-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        document.querySelectorAll('.catalog-tab').forEach(t => t.classList.remove('active'));
        e.target.classList.add('active');
        this.refreshCatalogList();
      });
    });

    document.getElementById('catalog-search')?.addEventListener('input', () => {
      this.refreshCatalogList();
    });

    document.getElementById('catalog-sort')?.addEventListener('change', () => {
      this.refreshCatalogList();
    });

    // Options slider/input
    const durationInput = document.getElementById('setting-rating-duration');
    const durationLabel = document.getElementById('setting-duration-label');
    if (durationInput && durationLabel) {
      durationInput.addEventListener('input', (e) => {
        const val = parseInt(e.target.value, 10);
        durationLabel.textContent = val === 0 ? 'Manual / Sticky (No auto-save)' : `${val} seconds`;
      });
    }

    document.getElementById('btn-save-settings')?.addEventListener('click', () => {
      const val = parseInt(document.getElementById('setting-rating-duration').value, 10);
      this.saveSettings(val);
      this.closeModalsAndPopovers();
    });

    // Danger Zone buttons
    document.getElementById('btn-danger-year')?.addEventListener('click', () => this.executeReset('year'));
    document.getElementById('btn-danger-all')?.addEventListener('click', () => this.executeReset('all_swipes'));
    document.getElementById('btn-danger-factory')?.addEventListener('click', () => this.executeReset('factory'));
  }

  initShortcuts() {
    this.shortcuts = new KeyboardShortcuts(this);
  }

  // =========================================================================
  // Menu Bar & Modals
  // =========================================================================
  initMenu() {
    const menuItems = document.querySelectorAll('.xp-menu-item');
    menuItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasActive = item.classList.contains('active');
        menuItems.forEach(m => m.classList.remove('active'));
        if (!wasActive) item.classList.add('active');
      });
    });

    window.addEventListener('click', () => {
      menuItems.forEach(m => m.classList.remove('active'));
    });

    // Menu Item Actions
    document.getElementById('menu-catalog')?.addEventListener('click', () => {
      this.openCatalogModal('all');
    });

    document.getElementById('menu-export')?.addEventListener('click', () => {
      this.openModal('modal-export');
    });

    document.getElementById('menu-stats')?.addEventListener('click', () => {
      this.openModal('modal-stats');
    });

    document.getElementById('menu-options')?.addEventListener('click', () => {
      this.openModal('modal-options');
    });

    document.getElementById('menu-danger')?.addEventListener('click', () => {
      this.openModal('modal-danger');
    });

    document.getElementById('menu-connect-mobile')?.addEventListener('click', () => {
      this.openMobileConnectModal();
    });

    document.getElementById('menu-about')?.addEventListener('click', () => {
      this.openModal('modal-about');
    });

    document.getElementById('menu-sound-toggle')?.addEventListener('click', () => {
      this.toggleSound();
    });

    document.getElementById('sound-toggle-btn')?.addEventListener('click', () => {
      this.toggleSound();
    });
  }

  initModals() {
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        this.closeModalsAndPopovers();
      });
    });

    document.querySelectorAll('.xp-modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.closeModalsAndPopovers();
        }
      });
    });
  }

  openModal(modalId) {
    this.playSound('click');
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('open');
  }

  async openMobileConnectModal() {
    this.openModal('modal-mobile');
    try {
      const info = await API.getNetworkInfo();
      const url = info.lan_url;
      document.getElementById('mobile-lan-url').textContent = url;
      document.getElementById('mobile-lan-link').href = url;

      // QR Code representation using Google Charts API or inline SVG QR
      const qrImg = document.getElementById('mobile-qr-img');
      if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}`;
      }
    } catch (e) {
      console.error(e);
    }
  }

  closeModalsAndPopovers() {
    document.querySelectorAll('.xp-modal-overlay').forEach(m => m.classList.remove('open'));
    if (this.quickTagActive) {
      this.savePendingQuickTag();
    }
  }

  renderStatsModal() {
    const counts = this.stats ? this.stats.status_counts : { played: 0, skipped: 0, backlog: 0 };
    document.getElementById('stat-played-count').textContent = counts.played;
    document.getElementById('stat-skipped-count').textContent = counts.skipped;
    document.getElementById('stat-backlog-count').textContent = counts.backlog;
    document.getElementById('stat-total-count').textContent = this.stats ? this.stats.total_swipes : 0;

    const tableBody = document.getElementById('stats-table-body');
    if (!tableBody || !this.stats || !this.stats.years) return;

    tableBody.innerHTML = '';
    const yearsList = Object.values(this.stats.years).sort((a, b) => b.year - a.year);

    yearsList.forEach(y => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight: bold;">${y.year}</td>
        <td>${y.played}</td>
        <td>${y.backlog}</td>
        <td>${y.skipped}</td>
        <td>${y.total_cached}</td>
        <td style="font-weight: bold; color: #003399;">${y.percentage_reviewed}%</td>
      `;
      tableBody.appendChild(tr);
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.app = new XPDeckApp();
});

/**
 * APP.JS: XP-Deck Application Coordinator & State Manager
 */

class XPDeckApp {
  constructor() {
    this.currentYear = 2004;
    this.queue = [];
    this.renderedCards = [];
    this.stats = null;
    this.soundEnabled = true;

    // Quick-tag popover state
    this.quickTagActive = false;
    this.quickTagTimer = null;
    this.pendingPlayedGame = null;
    this.selectedRating = null;

    // Web Audio Synthesizer
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

    // Check system status and load initial deck
    await this.refreshStats();
    await this.loadYear(this.currentYear);
  }

  // =========================================================================
  // Web Audio Synthesizer (Zero external audio file dependencies)
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
    const text = this.soundEnabled ? '🔊 Sound: ON' : '🔈 Sound: OFF';
    if (soundBtn) soundBtn.textContent = text;
    if (statusSound) statusSound.textContent = text;
  }

  playSound(type) {
    if (!this.soundEnabled || !this.audioCtx) return;
    try {
      const now = this.audioCtx.currentTime;

      if (type === 'click') {
        // Classic XP Start Menu / Navigation click
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
        // Card swipe whoosh
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
        // Authentic XP alert chime
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
        // Undo two-tone chime
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
    } catch (e) {
      // Audio playback failsafe
    }
  }

  // =========================================================================
  // Year Selector & Toolbar
  // =========================================================================
  initYearSelector() {
    const select = document.getElementById('year-select');
    if (!select) return;

    select.innerHTML = '';
    const currentYear = new Date().getFullYear();

    // From 2026 down to 1980
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

  async loadYear(year) {
    this.currentYear = year;
    const select = document.getElementById('year-select');
    if (select && select.value != year) select.value = year;

    this.setStatus(`Loading games for ${year}...`);
    this.queue = [];
    this.clearDeckDOM();

    try {
      const data = await API.getDeck(year, 30);
      this.queue = data.games || [];
      this.updateProgressBadge();
      this.renderInitialStack();
      this.setStatus(`Ready. ${this.queue.length} games in queue for ${year}.`);
    } catch (err) {
      console.error(err);
      this.setStatus(`Error loading ${year}. Using cached data.`);
      this.updateProgressBadge();
    }
  }

  // =========================================================================
  // 5-Card Buffered DOM Stack Manager
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
      if (emptyState) emptyState.classList.add('visible');
      if (this.gestures) this.gestures.attachTopCard(null);
      this.updateRemainingCount();
      return;
    }

    if (emptyState) emptyState.classList.remove('visible');

    // Pre-render up to 5 cards
    const initialBatch = this.queue.slice(0, 5);
    initialBatch.forEach((game, index) => {
      const cardEl = this.createCardElement(game, index);
      container.appendChild(cardEl);
      this.renderedCards.push(cardEl);
    });

    if (this.renderedCards.length > 0) {
      this.gestures.attachTopCard(this.renderedCards[0]);
    }
    this.updateRemainingCount();
  }

  createCardElement(game, index) {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.dataset.index = index;
    card.dataset.id = game.igdb_id;

    // Fallback cover if none provided
    const coverUrl = game.cover_url || 'https://images.igdb.com/igdb/image/upload/t_cover_big/nocover.png';
    const ratingDisplay = game.rating ? `★ ${game.rating}` : '★ Unrated';
    const genresDisplay = game.genres || 'Video Game';
    const platformsDisplay = game.platforms || 'Multiple Platforms';

    // Build screenshots gallery markup for card back
    let screenshotsHtml = '';
    if (Array.isArray(game.screenshots) && game.screenshots.length > 0) {
      screenshotsHtml = `
        <div class="screenshots-title">Screenshots Preview:</div>
        <div class="card-back-screenshots">
          ${game.screenshots.map(s => `<img class="screenshot-thumb" src="${s}" alt="screenshot" onclick="window.open('${s}', '_blank')">`).join('')}
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
              <span>💡 Tap card to flip for details</span>
            </div>
          </div>
        </div>

        <!-- Back Side -->
        <div class="card-back">
          <div class="card-back-header">
            <span>💾 ${game.title} (${game.release_year})</span>
            <span class="card-back-close" title="Flip Back">✕</span>
          </div>
          <div class="card-back-content">
            <div class="card-back-summary">
              ${game.summary || 'No synopsis available for this title.'}
            </div>
            <div class="card-back-meta">
              <div class="meta-box">
                <strong>Genres:</strong>
                <span>${genresDisplay}</span>
              </div>
              <div class="meta-box">
                <strong>Rating / Reviews:</strong>
                <span>${ratingDisplay} (${game.total_rating_count || 0} reviews)</span>
              </div>
            </div>
            <div class="meta-box">
              <strong>Platforms:</strong>
              <span>${platformsDisplay}</span>
            </div>
            ${screenshotsHtml}
          </div>
        </div>
      </div>
    `;

    // Back button click listener to flip back
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
  // Swipe & Gestures Handling
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

    const swipedGame = this.queue.shift(); // Remove from memory queue
    this.renderedCards.shift(); // Remove from DOM tracked list

    // Handle Quick-tag Popover if Played
    if (action === 'played' && swipedGame) {
      this.openQuickTag(swipedGame);
    } else if (swipedGame) {
      // Save Skipped or Backlog immediately
      this.commitSwipe(swipedGame.igdb_id, action);
    }

    // After animation ends, remove DOM node and slide remaining cards up
    setTimeout(() => {
      cardEl.remove();
      this.shiftDeckStack();
    }, 250);
  }

  shiftDeckStack() {
    const container = document.getElementById('deck-container');

    // Update existing cards' indices
    this.renderedCards.forEach((card, idx) => {
      card.dataset.index = idx;
    });

    // If queue still has cards not yet in DOM, render next card at index 4
    if (this.queue.length >= this.renderedCards.length && this.renderedCards.length < 5) {
      const nextGameIndex = this.renderedCards.length;
      const nextGame = this.queue[nextGameIndex];
      if (nextGame) {
        const newCard = this.createCardElement(nextGame, this.renderedCards.length);
        container.appendChild(newCard);
        this.renderedCards.push(newCard);
      }
    }

    // Attach gestures to new top card
    if (this.renderedCards.length > 0) {
      this.gestures.attachTopCard(this.renderedCards[0]);
    } else {
      this.gestures.attachTopCard(null);
      const emptyState = document.getElementById('deck-empty');
      if (emptyState) emptyState.classList.add('visible');
    }

    this.updateRemainingCount();

    // Auto-prefetch when buffer runs low (< 6 remaining)
    if (this.queue.length < 6 && this.queue.length > 0) {
      this.prefetchMoreGames();
    }
  }

  async prefetchMoreGames() {
    try {
      const data = await API.getDeck(this.currentYear, 25);
      if (data.games && data.games.length > 0) {
        const existingIds = new Set(this.queue.map(g => g.igdb_id));
        const newGames = data.games.filter(g => !existingIds.has(g.igdb_id));
        this.queue.push(...newGames);
        this.updateRemainingCount();
      }
    } catch (e) {
      // Prefetch failsafe
    }
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
  // Quick-Tag Popover (2-second auto-save for Played games)
  // =========================================================================
  openQuickTag(game) {
    // If an existing pending game exists, save it immediately before opening new
    if (this.pendingPlayedGame) {
      this.savePendingQuickTag();
    }

    this.pendingPlayedGame = game;
    this.selectedRating = null;
    this.quickTagActive = true;

    const popover = document.getElementById('quicktag-popover');
    const titleEl = document.getElementById('quicktag-title');
    const platformSelect = document.getElementById('quicktag-platform');
    const fillEl = document.getElementById('quicktag-timer-fill');

    if (!popover) return;

    if (titleEl) titleEl.textContent = `Tagged: ${game.title}`;

    // Populate platform options from game metadata
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

    // Reset rating buttons
    const ratingBtns = popover.querySelectorAll('.rating-btn');
    ratingBtns.forEach(b => b.classList.remove('active'));

    // Reset timer bar animation
    if (fillEl) {
      fillEl.style.transition = 'none';
      fillEl.style.width = '100%';
      void fillEl.offsetWidth; // Trigger reflow
      fillEl.style.transition = 'width 2.5s linear';
      fillEl.style.width = '0%';
    }

    popover.classList.add('visible');

    // Clear old timer and set 2.5s auto-save timer
    if (this.quickTagTimer) clearTimeout(this.quickTagTimer);
    this.quickTagTimer = setTimeout(() => {
      this.savePendingQuickTag();
    }, 2500);
  }

  setQuickRating(rating) {
    this.selectedRating = rating;
    const popover = document.getElementById('quicktag-popover');
    if (!popover) return;
    const ratingBtns = popover.querySelectorAll('.rating-btn');
    ratingBtns.forEach(b => {
      b.classList.toggle('active', parseInt(b.dataset.val, 10) === rating);
    });

    // Reset timer slightly to give user time to hit another button or save
    if (this.quickTagTimer) clearTimeout(this.quickTagTimer);
    const fillEl = document.getElementById('quicktag-timer-fill');
    if (fillEl) {
      fillEl.style.transition = 'none';
      fillEl.style.width = '100%';
      void fillEl.offsetWidth;
      fillEl.style.transition = 'width 1.5s linear';
      fillEl.style.width = '0%';
    }
    this.quickTagTimer = setTimeout(() => {
      this.savePendingQuickTag();
    }, 1500);
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

      // If restored game belongs to current year, push back to front of queue
      if (restoredGame.release_year === this.currentYear) {
        this.queue.unshift(restoredGame);
        
        // Prepend card back onto DOM
        const container = document.getElementById('deck-container');
        const emptyState = document.getElementById('deck-empty');
        if (emptyState) emptyState.classList.remove('visible');

        const newCard = this.createCardElement(restoredGame, 0);
        newCard.style.opacity = '0';
        newCard.style.transform = 'translateY(-30px) scale(0.9)';
        container.insertBefore(newCard, container.firstChild);
        this.renderedCards.unshift(newCard);

        // Animate entrance
        void newCard.offsetWidth;
        newCard.style.transition = 'all 0.3s cubic-bezier(0.2, 0.9, 0.3, 1)';
        newCard.style.opacity = '1';
        newCard.style.transform = 'translateY(0) scale(1)';

        // Update indices
        this.renderedCards.forEach((c, idx) => c.dataset.index = idx);
        this.gestures.attachTopCard(this.renderedCards[0]);
        this.updateRemainingCount();
      } else {
        // If it was from a different year, offer to switch or just notify
        this.setStatus(`Restored "${restoredGame.title}" (${restoredGame.release_year}).`);
      }

      await this.refreshStats();
    } catch (err) {
      console.error(err);
      this.setStatus('Undo failed.');
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
  // Controls & On-Screen Buttons
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

    // Quicktag rating buttons
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
  }

  initShortcuts() {
    this.shortcuts = new KeyboardShortcuts(this);
  }

  // =========================================================================
  // Menu Bar & Dialogs
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

    // Menu Actions
    document.getElementById('menu-export')?.addEventListener('click', () => {
      this.openModal('modal-export');
    });

    document.getElementById('menu-stats')?.addEventListener('click', () => {
      this.openModal('modal-stats');
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
    // Close modal on click of close buttons or outside click
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

    // Breakdown Table
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

// Bootstrap on DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  window.app = new XPDeckApp();
});

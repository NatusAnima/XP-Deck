/**
 * SHORTCUTS.JS: Desktop keyboard controls for the deck.
 */

// Fields that consume every keystroke.
const TEXT_FIELDS = 'input, textarea, select, [contenteditable]';

// Controls that consume only Space and Enter. Without this, preventDefault()
// on Space meant no button in the app could be activated from the keyboard -
// but blocking every key here would stop swiping after any button click.
const ACTIVATABLE = 'a, button, [role="button"]';

class KeyboardShortcuts {
  constructor(app) {
    this.app = app;
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  onKeyDown(e) {
    // Escape always applies, even from inside a field
    if (e.key === 'Escape') {
      document.activeElement?.blur();
      this.app.handleEscape();
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.app.undoLastSwipe();
      }
      return;
    }

    if (e.altKey) return;

    const active = document.activeElement;
    if (active?.closest(TEXT_FIELDS)) return;
    if ((e.key === ' ' || e.key === 'Enter') && active?.closest(ACTIVATABLE)) return;

    // 1-9 rate directly, 0 is 10 - the UI offers a 10 but there is no 10 key
    if (this.app.quickTagActive && /^[0-9]$/.test(e.key)) {
      e.preventDefault();
      this.app.setQuickRating(e.key === '0' ? 10 : Number(e.key));
      return;
    }

    const actions = {
      d: () => this.app.handleSwipeAction('played'),
      arrowright: () => this.app.handleSwipeAction('played'),
      a: () => this.app.handleSwipeAction('skipped'),
      arrowleft: () => this.app.handleSwipeAction('skipped'),
      w: () => this.app.handleSwipeAction('backlog'),
      arrowup: () => this.app.handleSwipeAction('backlog'),
      f: () => this.app.flipTopCard(),
      ' ': () => this.app.flipTopCard(),
      u: () => this.app.undoLastSwipe()
    };

    const action = actions[e.key.toLowerCase()];
    if (action) {
      e.preventDefault();
      action();
    }
  }
}

window.KeyboardShortcuts = KeyboardShortcuts;

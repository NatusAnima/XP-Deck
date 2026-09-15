/**
 * SHORTCUTS.JS: Desktop keyboard listeners for rapid swiping and navigation
 */

class KeyboardShortcuts {
  constructor(app) {
    this.app = app;
    this.init();
  }

  init() {
    window.addEventListener('keydown', (e) => {
      // Don't intercept if user is typing in an input or select
      const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
      if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
        if (e.key === 'Escape') {
          document.activeElement.blur();
        }
        return;
      }

      // Check for Ctrl+Z (Undo)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        this.app.undoLastSwipe();
        return;
      }

      const key = e.key;

      switch (key) {
        // Played (Right)
        case 'd':
        case 'D':
        case 'ArrowRight':
          e.preventDefault();
          this.app.handleSwipeAction('played');
          break;

        // Skipped (Left)
        case 'a':
        case 'A':
        case 'ArrowLeft':
          e.preventDefault();
          this.app.handleSwipeAction('skipped');
          break;

        // Backlog (Up)
        case 'w':
        case 'W':
        case 'ArrowUp':
          e.preventDefault();
          this.app.handleSwipeAction('backlog');
          break;

        // Flip Card
        case ' ':
        case 'f':
        case 'F':
        case 'Enter':
          e.preventDefault();
          this.app.flipTopCard();
          break;

        // Undo (single key 'U')
        case 'u':
        case 'U':
          e.preventDefault();
          this.app.undoLastSwipe();
          break;

        // Escape (Close popover / modals)
        case 'Escape':
          e.preventDefault();
          this.app.closeModalsAndPopovers();
          break;

        // Rating keys 1-9
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          if (this.app.quickTagActive) {
            e.preventDefault();
            this.app.setQuickRating(parseInt(key, 10));
          }
          break;
      }
    });
  }
}

window.KeyboardShortcuts = KeyboardShortcuts;

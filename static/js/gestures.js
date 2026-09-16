/**
 * GESTURES.JS: Pointer-driven swipe physics for the card deck.
 */

// Anything the user should be able to touch without dragging the card.
const INTERACTIVE = 'a, button, input, select, textarea, label, .card-back-summary, .screenshot-thumb';

const FLY_CLASS = { played: 'fly-right', skipped: 'fly-left', backlog: 'fly-up' };

const DIST_X = 85;      // px before a horizontal swipe commits
const DIST_Y = 75;      // px before an upward swipe commits
const VELOCITY = 0.38;  // px/ms - a fast flick commits below the distances
const TAP_SLOP = 8;     // px of movement still counted as a tap

class CardGestures {
  constructor(container, onSwipe, onTap) {
    this.container = container;
    this.onSwipe = onSwipe;
    this.onTap = onTap;
    this.activeCard = null;

    this.dragging = false;
    this.start = { x: 0, y: 0, t: 0 };
    this.delta = { x: 0, y: 0 };
    this.frame = null;

    container.addEventListener('pointerdown', (e) => this.onDown(e));
    container.addEventListener('pointermove', (e) => this.onMove(e));
    container.addEventListener('pointerup', (e) => this.onUp(e));
    container.addEventListener('pointercancel', () => this.cancel());
  }

  attachTopCard(card) {
    this.activeCard = card;
  }

  onDown(e) {
    if (!this.activeCard || e.button !== 0) return;
    // let taps reach links, buttons and form fields on the card back
    if (e.target.closest(INTERACTIVE)) return;

    this.dragging = true;
    this.start = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.delta = { x: 0, y: 0 };
    this.container.setPointerCapture(e.pointerId);
    this.activeCard.style.transition = 'none';
  }

  onMove(e) {
    if (!this.dragging || !this.activeCard) return;

    this.delta = { x: e.clientX - this.start.x, y: e.clientY - this.start.y };

    // Pointer events can outpace the display; one write per frame is enough.
    this.frame ??= requestAnimationFrame(() => {
      this.frame = null;
      this.paint();
    });
  }

  paint() {
    if (!this.activeCard) return;
    const { x, y } = this.delta;
    this.activeCard.style.transform = `translate(${x}px, ${y}px) rotate(${x * 0.08}deg)`;

    const absX = Math.abs(x);
    const absY = Math.abs(y);
    let played = 0, skipped = 0, backlog = 0;

    if (y < -25 && absY > absX * 0.8) backlog = Math.min(1, absY / 90);
    else if (x > 20) played = Math.min(1, x / 90);
    else if (x < -20) skipped = Math.min(1, absX / 90);

    this.setBadge('.stamp-played', played);
    this.setBadge('.stamp-skipped', skipped);
    this.setBadge('.stamp-backlog', backlog);
  }

  setBadge(selector, opacity) {
    const badge = this.activeCard.querySelector(selector);
    if (badge) badge.style.opacity = String(opacity);
  }

  onUp(e) {
    if (!this.dragging) return;
    this.dragging = false;

    cancelAnimationFrame(this.frame);
    this.frame = null;

    if (this.container.hasPointerCapture(e.pointerId)) {
      this.container.releasePointerCapture(e.pointerId);
    }
    if (!this.activeCard) return;

    const { x, y } = this.delta;
    const absX = Math.abs(x);
    const absY = Math.abs(y);
    const elapsed = Math.max(1, performance.now() - this.start.t);
    const vx = x / elapsed;
    const vy = y / elapsed;

    if (absX < TAP_SLOP && absY < TAP_SLOP && elapsed < 300) {
      this.reset();
      this.onTap(this.activeCard);
      return;
    }

    if ((y < -DIST_Y && absY > absX * 0.8) || (vy < -VELOCITY && absY > absX)) {
      this.swipe('backlog');
    } else if (x > DIST_X || vx > VELOCITY) {
      this.swipe('played');
    } else if (x < -DIST_X || vx < -VELOCITY) {
      this.swipe('skipped');
    } else {
      this.reset();
    }
  }

  cancel() {
    this.dragging = false;
    this.reset();
  }

  reset() {
    if (!this.activeCard) return;
    this.activeCard.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1)';
    this.activeCard.style.transform = '';
    this.activeCard.querySelectorAll('.stamp-badge')
      .forEach(b => { b.style.opacity = '0'; });
  }

  swipe(action) {
    const card = this.activeCard;
    if (!card) return;
    this.activeCard = null;   // detach immediately so the next input is ignored
    card.classList.add(FLY_CLASS[action]);
    this.onSwipe(card, action);
  }

  /** Swipe the top card from a button or keyboard shortcut. */
  triggerAction(action) {
    if (this.activeCard && FLY_CLASS[action]) this.swipe(action);
  }
}

window.CardGestures = CardGestures;

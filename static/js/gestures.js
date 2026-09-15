/**
 * GESTURES.JS: Momentum-aware touch and mouse pointer physics for card deck
 */

class CardGestures {
  constructor(container, onSwipeCallback, onFlipCallback) {
    this.container = container;
    this.onSwipe = onSwipeCallback;
    this.onFlip = onFlipCallback;
    this.activeCard = null;

    this.isDragging = false;
    this.startX = 0;
    this.startY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.startTime = 0;

    this.boundPointerDown = this.handlePointerDown.bind(this);
    this.boundPointerMove = this.handlePointerMove.bind(this);
    this.boundPointerUp = this.handlePointerUp.bind(this);
    this.boundPointerCancel = this.handlePointerCancel.bind(this);

    this.initEvents();
  }

  initEvents() {
    this.container.addEventListener('pointerdown', this.boundPointerDown);
    this.container.addEventListener('pointermove', this.boundPointerMove);
    this.container.addEventListener('pointerup', this.boundPointerUp);
    this.container.addEventListener('pointercancel', this.boundPointerCancel);
  }

  attachTopCard(cardElement) {
    this.activeCard = cardElement;
  }

  handlePointerDown(e) {
    if (!this.activeCard) return;

    // Check if target is an interactive element on back of card
    const target = e.target;
    if (target.closest('.card-back-close') || target.closest('.screenshot-thumb') || target.closest('a') || target.closest('button')) {
      return;
    }

    // Only allow primary button (left mouse or touch)
    if (e.button !== undefined && e.button !== 0) return;

    this.isDragging = true;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.currentX = e.clientX;
    this.currentY = e.clientY;
    this.startTime = performance.now();

    try {
      this.container.setPointerCapture(e.pointerId);
    } catch (err) {
      // Ignore if pointer capture isn't supported or fails
    }

    this.activeCard.style.transition = 'none';
  }

  handlePointerMove(e) {
    if (!this.isDragging || !this.activeCard) return;

    this.currentX = e.clientX;
    this.currentY = e.clientY;

    const deltaX = this.currentX - this.startX;
    const deltaY = this.currentY - this.startY;
    const rotateDeg = deltaX * 0.08;

    // Apply translation & proportional tilt
    const isFlipped = this.activeCard.classList.contains('flipped');
    const baseRotation = isFlipped ? 180 : 0;
    
    this.activeCard.style.transform = `translate(${deltaX}px, ${deltaY}px) rotate(${rotateDeg}deg)`;

    // Update stamp badges opacity
    const playedBadge = this.activeCard.querySelector('.stamp-played');
    const skippedBadge = this.activeCard.querySelector('.stamp-skipped');
    const backlogBadge = this.activeCard.querySelector('.stamp-backlog');

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    if (playedBadge) playedBadge.style.opacity = '0';
    if (skippedBadge) skippedBadge.style.opacity = '0';
    if (backlogBadge) backlogBadge.style.opacity = '0';

    if (deltaY < -25 && absY > absX * 0.8) {
      // Swiping up (Backlog)
      if (backlogBadge) {
        backlogBadge.style.opacity = Math.min(1, absY / 90).toString();
      }
    } else if (deltaX > 20) {
      // Swiping right (Played)
      if (playedBadge) {
        playedBadge.style.opacity = Math.min(1, deltaX / 90).toString();
      }
    } else if (deltaX < -20) {
      // Swiping left (Skipped)
      if (skippedBadge) {
        skippedBadge.style.opacity = Math.min(1, absX / 90).toString();
      }
    }
  }

  handlePointerUp(e) {
    if (!this.isDragging) return;
    this.isDragging = false;

    try {
      if (this.container.hasPointerCapture(e.pointerId)) {
        this.container.releasePointerCapture(e.pointerId);
      }
    } catch (err) {}

    if (!this.activeCard) return;

    const deltaX = this.currentX - this.startX;
    const deltaY = this.currentY - this.startY;
    const elapsed = Math.max(1, performance.now() - this.startTime);
    const vx = deltaX / elapsed;
    const vy = deltaY / elapsed;

    const absX = Math.abs(deltaX);
    const absY = Math.abs(deltaY);

    // Tap Detection (card flip)
    if (absX < 8 && absY < 8 && elapsed < 300) {
      this.resetCardPosition();
      if (this.onFlip) this.onFlip(this.activeCard);
      return;
    }

    // Swipe Thresholds (Distance or Momentum Velocity)
    const distThresholdX = 85;
    const distThresholdY = 75;
    const velThreshold = 0.38;

    if (deltaY < -distThresholdY && absY > absX * 0.8 || vy < -velThreshold && absY > absX) {
      // Backlog Swipe
      this.executeSwipe('backlog', 'fly-up');
    } else if (deltaX > distThresholdX || vx > velThreshold) {
      // Played Swipe
      this.executeSwipe('played', 'fly-right');
    } else if (deltaX < -distThresholdX || vx < -velThreshold) {
      // Skipped Swipe
      this.executeSwipe('skipped', 'fly-left');
    } else {
      // Spring back to center
      this.resetCardPosition();
    }
  }

  handlePointerCancel() {
    this.isDragging = false;
    this.resetCardPosition();
  }

  resetCardPosition() {
    if (!this.activeCard) return;
    this.activeCard.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.9, 0.3, 1)';
    this.activeCard.style.transform = 'translate(0px, 0px) rotate(0deg)';

    const badges = this.activeCard.querySelectorAll('.stamp-badge');
    badges.forEach(b => b.style.opacity = '0');
  }

  executeSwipe(action, flyClass) {
    if (!this.activeCard) return;
    const card = this.activeCard;
    this.activeCard = null; // Detach immediately

    card.classList.add(flyClass);

    // Trigger callback
    if (this.onSwipe) {
      this.onSwipe(card, action);
    }
  }

  triggerAction(action) {
    if (!this.activeCard) return;
    const flyMap = {
      'played': 'fly-right',
      'skipped': 'fly-left',
      'backlog': 'fly-up'
    };
    this.executeSwipe(action, flyMap[action] || 'fly-right');
  }
}

window.CardGestures = CardGestures;

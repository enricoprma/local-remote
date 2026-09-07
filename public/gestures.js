const TAP_DISTANCE = 12;
const LONG_PRESS_MS = 500;

const POINTER_SENSITIVITY = 4;
const SCROLL_SENSITIVITY = 5;

const MAX_POINTER_MOVE = 500;
const MAX_SCROLL = 20;

export function setupGestures(
  touchArea,
  {
    onTap,
    onMove,
    onScroll,
    onLongPress,
    onLongPressCancel,
  },
) {
  const pointers = new Map();

  let mode = "idle";
  let primary = null;

  let longPressTimer = null;

  let lastScrollY = 0;
  let scrollRemainder = 0;

  /*
  * Gesture states:
  *
  * IDLE --1 finger--> POINTER --hold--> LONG PRESS
  *                       |
  *                       +--2 fingers--> SCROLL
  *
  * POINTER    --release--> IDLE
  * LONG PRESS --release--> IDLE
  *
  * SCROLL --release--> BLOCKED --all released--> IDLE
  *
  * Unsupported pointer combinations -> BLOCKED
  */

  touchArea.addEventListener("pointerdown", pointerDown);
  touchArea.addEventListener("pointermove", pointerMove);
  touchArea.addEventListener("pointerup", pointerUp);
  touchArea.addEventListener("pointercancel", pointerCancel);

  function pointerDown(event) {
    if (event.button !== 0 || pointers.has(event.pointerId)) {
      return;
    }

    event.preventDefault();

    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    touchArea.setPointerCapture(event.pointerId);

    // Ignore new gestures until every finger from the old gesture is gone.
    if (mode === "blocked") {
      return;
    }

    // First finger = mouse movement / tap / long press.
    if (pointers.size === 1) {
      startPointer(event);
      return;
    }

    // Second finger = scroll.
    if (pointers.size === 2 && mode === "pointer") {
      startScroll();
      return;
    }

    // A second finger while the long press is active closes keyboard mode.
    if (pointers.size === 2 && mode === "longpress") {
      onLongPressCancel();
      blockGesture();
      return;
    }

    // Three or more fingers: ignore everything until all are released.
    blockGesture();
  }

  function pointerMove(event) {
    const pointer = pointers.get(event.pointerId);

    if (!pointer) {
      return;
    }

    event.preventDefault();

    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (mode === "pointer" && primary?.id === event.pointerId) {
      movePointer(event);
    }

    if (mode === "scroll") {
      moveScroll();
    }
  }

  function pointerUp(event) {
    const pointer = pointers.get(event.pointerId);

    if (!pointer) {
      return;
    }

    event.preventDefault();

    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (mode === "pointer" && primary?.id === event.pointerId) {
      finishPointer(event);
    } else if (
      mode === "longpress" &&
      primary?.id === event.pointerId
    ) {
      primary = null;
      mode = "idle";
    } else if (mode === "scroll") {
      moveScroll();

      // Don't turn the remaining finger into a new mouse gesture.
      mode = "blocked";
    }

    pointers.delete(event.pointerId);

    if (mode === "blocked" && pointers.size === 0) {
      mode = "idle";
    }
  }

  function pointerCancel(event) {
    if (!pointers.has(event.pointerId)) {
      return;
    }

    if (
      mode === "longpress" &&
      primary?.id === event.pointerId
    ) {
      onLongPressCancel();
    }

    clearLongPress();

    primary = null;
    scrollRemainder = 0;

    pointers.delete(event.pointerId);

    mode = pointers.size === 0 ? "idle" : "blocked";
  }

  // ---------------------------------------------------------------------------
  // One finger
  // ---------------------------------------------------------------------------

  function startPointer(event) {
    mode = "pointer";

    primary = {
      id: event.pointerId,

      startX: event.clientX,
      startY: event.clientY,

      lastX: event.clientX,
      lastY: event.clientY,

      startedAt: performance.now(),
      moved: false,
    };

    longPressTimer = window.setTimeout(() => {
      if (
        mode !== "pointer" ||
        primary?.moved ||
        pointers.size !== 1
      ) {
        return;
      }

      mode = "longpress";
      onLongPress();
    }, LONG_PRESS_MS);
  }

  function movePointer(event) {
    const dx = event.clientX - primary.lastX;
    const dy = event.clientY - primary.lastY;

    primary.lastX = event.clientX;
    primary.lastY = event.clientY;

    const distance = Math.hypot(
      event.clientX - primary.startX,
      event.clientY - primary.startY,
    );

    if (distance > TAP_DISTANCE) {
      primary.moved = true;
      clearLongPress();
    }

    const moveX = limit(
      Math.trunc(dx * POINTER_SENSITIVITY),
      MAX_POINTER_MOVE,
    );

    const moveY = limit(
      Math.trunc(dy * POINTER_SENSITIVITY),
      MAX_POINTER_MOVE,
    );

    if (moveX !== 0 || moveY !== 0) {
      onMove(moveX, moveY);
    }
  }

  function finishPointer(event) {
    movePointer(event);
    clearLongPress();

    const heldFor =
      performance.now() - primary.startedAt;

    if (!primary.moved) {
      if (heldFor >= LONG_PRESS_MS) {
        // Fallback in case pointerup wins the race against the timer.
        onLongPress();
      } else {
        onTap();
      }
    }

    primary = null;
    mode = "idle";
  }

  // ---------------------------------------------------------------------------
  // Two fingers
  // ---------------------------------------------------------------------------

  function startScroll() {
    clearLongPress();

    primary = null;
    mode = "scroll";

    scrollRemainder = 0;
    lastScrollY = centerY();
  }

  function moveScroll() {
    const currentY = centerY();

    if (currentY === null) {
      return;
    }

    const rawSteps =
      (currentY - lastScrollY) * SCROLL_SENSITIVITY +
      scrollRemainder;

    lastScrollY = currentY;

    const wholeSteps = Math.trunc(rawSteps);
    scrollRemainder = rawSteps - wholeSteps;

    const steps = limit(wholeSteps, MAX_SCROLL);

    if (steps !== 0) {
      onScroll(steps);
    }
  }

  function centerY() {
    if (pointers.size !== 2) {
      return null;
    }

    const [first, second] = pointers.values();

    return (first.y + second.y) / 2;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function clearLongPress() {
    if (longPressTimer === null) {
      return;
    }

    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function blockGesture() {
    clearLongPress();

    primary = null;
    scrollRemainder = 0;

    mode = "blocked";
  }
}

function limit(value, max) {
  return Math.max(-max, Math.min(max, value));
}
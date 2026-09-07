const TAP_MAX_DISTANCE = 12;
const TAP_MAX_DURATION = 500;
const LONG_PRESS_DURATION = 500;
const POINTER_SENSITIVITY = 4;
const MAX_POINTER_DELTA = 500;
const SCROLL_PIXELS_PER_STEP = 0.2;
const MAX_SCROLL_DELTA = 20;

export function setupGestures(touchArea, {
  onTap,
  onMove,
  onScroll,
  onLongPress,
  onLongPressCancel,
}) {
  const activePointers = new Map();
  let gesture = null;
  let waitForAllPointersToEnd = false;

  touchArea.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || activePointers.has(event.pointerId)) {
      return;
    }

    event.preventDefault();
    activePointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    touchArea.setPointerCapture(event.pointerId);

    if (waitForAllPointersToEnd) {
      // Completed or cancelled multi-pointer gestures stay inert until all pointers end.
      return;
    }

    if (activePointers.size === 1 && gesture === null) {
      gesture = createPointerGesture(event);
      return;
    }

    if (activePointers.size === 2 && gesture?.type === "pointer") {
      if (gesture.longPressRecognized) {
        // A second pointer exits keyboard mode after long-press recognition; it does not scroll.
        discardPendingMovement(gesture);
        onLongPressCancel();
        gesture = null;
        waitForAllPointersToEnd = true;
        return;
      }

      // Movement queued for the pointer gesture must not leak into the scroll gesture.
      discardPendingMovement(gesture);
      gesture = createScrollGesture();
      return;
    }

    discardGesture(gesture);
    gesture = null;
    waitForAllPointersToEnd = true;
  });

  touchArea.addEventListener("pointermove", (event) => {
    const pointer = activePointers.get(event.pointerId);

    if (!pointer) {
      return;
    }

    event.preventDefault();
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (waitForAllPointersToEnd) {
      return;
    }

    if (gesture?.type === "pointer" && event.pointerId === gesture.pointerId) {
      if (gesture.longPressRecognized) {
        // Long-press mode suppresses later movement and tap recognition.
        return;
      }

      collectPointerMovement(gesture, event);
      return;
    }

    if (
      gesture?.type === "scroll" &&
      gesture.pointerIds.includes(event.pointerId)
    ) {
      collectScrollMovement(gesture);
    }
  });

  touchArea.addEventListener("pointerup", (event) => {
    const pointer = activePointers.get(event.pointerId);

    if (!pointer) {
      return;
    }

    event.preventDefault();
    pointer.x = event.clientX;
    pointer.y = event.clientY;

    if (
      !waitForAllPointersToEnd &&
      gesture?.type === "pointer" &&
      event.pointerId === gesture.pointerId
    ) {
      finishPointerGesture(gesture, event);
    } else if (
      !waitForAllPointersToEnd &&
      gesture?.type === "scroll" &&
      gesture.pointerIds.includes(event.pointerId)
    ) {
      collectScrollMovement(gesture);
      gesture = null;
      waitForAllPointersToEnd = true;
    }

    activePointers.delete(event.pointerId);

    if (activePointers.size === 0) {
      waitForAllPointersToEnd = false;
    }
  });

  touchArea.addEventListener("pointercancel", (event) => {
    if (!activePointers.has(event.pointerId)) {
      return;
    }

    if (
      gesture?.type === "pointer" &&
      event.pointerId === gesture.pointerId
    ) {
      discardPendingMovement(gesture);
      gesture = null;
    } else if (
      gesture?.type === "scroll" &&
      gesture.pointerIds.includes(event.pointerId)
    ) {
      discardPendingScroll(gesture);
      gesture = null;
      waitForAllPointersToEnd = true;
    }

    activePointers.delete(event.pointerId);

    if (activePointers.size === 0) {
      waitForAllPointersToEnd = false;
    }
  });

  function createPointerGesture(event) {
    const pointerGesture = {
      type: "pointer",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      startTime: performance.now(),
      movedBeyondTapDistance: false,
      longPressRecognized: false,
      longPressTimeoutId: null,
      pendingDx: 0,
      pendingDy: 0,
      animationFrameId: null,
    };

    pointerGesture.longPressTimeoutId = window.setTimeout(() => {
      recognizeLongPress(pointerGesture);
    }, LONG_PRESS_DURATION);

    return pointerGesture;
  }

  function finishPointerGesture(activeGesture, event) {
    gesture = null;

    if (activeGesture.longPressRecognized) {
      discardPendingMovement(activeGesture);
      onLongPress();
      return;
    }

    collectPointerMovement(activeGesture, event);
    cancelLongPress(activeGesture);

    const duration = performance.now() - activeGesture.startTime;

    if (
      !activeGesture.movedBeyondTapDistance &&
      duration >= LONG_PRESS_DURATION
    ) {
      discardPendingMovement(activeGesture);
      onLongPress();
      return;
    }

    if (
      !activeGesture.movedBeyondTapDistance &&
      duration <= TAP_MAX_DURATION
    ) {
      onTap();
    }
  }

  function recognizeLongPress(activeGesture) {
    activeGesture.longPressTimeoutId = null;

    if (
      gesture !== activeGesture ||
      activeGesture.movedBeyondTapDistance ||
      activePointers.size !== 1 ||
      waitForAllPointersToEnd
    ) {
      return;
    }

    activeGesture.longPressRecognized = true;
    discardPendingMovement(activeGesture);
    onLongPress();
  }

  function createScrollGesture() {
    const pointerIds = [...activePointers.keys()];

    return {
      type: "scroll",
      pointerIds,
      lastCenterY: getPointerCenterY(pointerIds),
      pendingDy: 0,
      animationFrameId: null,
    };
  }

  function collectScrollMovement(activeGesture) {
    const centerY = getPointerCenterY(activeGesture.pointerIds);

    if (centerY === null) {
      return;
    }

    const dy = centerY - activeGesture.lastCenterY;
    activeGesture.lastCenterY = centerY;

    if (dy === 0) {
      return;
    }

    activeGesture.pendingDy += dy;

    if (activeGesture.animationFrameId === null) {
      activeGesture.animationFrameId = requestAnimationFrame(() => {
        flushScrollMovement(activeGesture);
      });
    }
  }

  function getPointerCenterY(pointerIds) {
    const firstPointer = activePointers.get(pointerIds[0]);
    const secondPointer = activePointers.get(pointerIds[1]);

    if (!firstPointer || !secondPointer) {
      return null;
    }

    return (firstPointer.y + secondPointer.y) / 2;
  }

  function flushScrollMovement(activeGesture) {
    activeGesture.animationFrameId = null;

    const steps = limitScrollDelta(
      Math.trunc(activeGesture.pendingDy / SCROLL_PIXELS_PER_STEP),
    );
    activeGesture.pendingDy -= steps * SCROLL_PIXELS_PER_STEP;

    if (steps !== 0) {
      onScroll(steps);
    }

    // Keep fractional movement for the next frame instead of dropping it.
    if (Math.abs(activeGesture.pendingDy) >= SCROLL_PIXELS_PER_STEP) {
      activeGesture.animationFrameId = requestAnimationFrame(() => {
        flushScrollMovement(activeGesture);
      });
    }
  }

  function discardPendingScroll(activeGesture) {
    if (activeGesture.animationFrameId !== null) {
      cancelAnimationFrame(activeGesture.animationFrameId);
    }

    activeGesture.pendingDy = 0;
    activeGesture.animationFrameId = null;
  }

  function discardGesture(activeGesture) {
    if (activeGesture?.type === "pointer") {
      discardPendingMovement(activeGesture);
    } else if (activeGesture?.type === "scroll") {
      discardPendingScroll(activeGesture);
    }
  }

  function collectPointerMovement(activeGesture, event) {
    const dx = event.clientX - activeGesture.lastX;
    const dy = event.clientY - activeGesture.lastY;

    activeGesture.lastX = event.clientX;
    activeGesture.lastY = event.clientY;

    if (
      Math.hypot(
        event.clientX - activeGesture.startX,
        event.clientY - activeGesture.startY,
      ) > TAP_MAX_DISTANCE
    ) {
      if (!activeGesture.movedBeyondTapDistance) {
        activeGesture.movedBeyondTapDistance = true;
        cancelLongPress(activeGesture);
      }
    }

    if (dx === 0 && dy === 0) {
      return;
    }

    activeGesture.pendingDx += dx * POINTER_SENSITIVITY;
    activeGesture.pendingDy += dy * POINTER_SENSITIVITY;

    if (activeGesture.animationFrameId === null) {
      activeGesture.animationFrameId = requestAnimationFrame(() => {
        flushPointerMovement(activeGesture);
      });
    }
  }

  function flushPointerMovement(activeGesture) {
    activeGesture.animationFrameId = null;

    const dx = limitPointerDelta(Math.trunc(activeGesture.pendingDx));
    const dy = limitPointerDelta(Math.trunc(activeGesture.pendingDy));

    activeGesture.pendingDx -= dx;
    activeGesture.pendingDy -= dy;

    if (dx !== 0 || dy !== 0) {
      onMove(dx, dy);
    }

    // Continue draining queued movement after a capped batch or fractional result.
    if (
      Math.abs(activeGesture.pendingDx) >= 1 ||
      Math.abs(activeGesture.pendingDy) >= 1
    ) {
      activeGesture.animationFrameId = requestAnimationFrame(() => {
        flushPointerMovement(activeGesture);
      });
    }
  }

  function discardPendingMovement(activeGesture) {
    cancelLongPress(activeGesture);

    if (activeGesture.animationFrameId !== null) {
      cancelAnimationFrame(activeGesture.animationFrameId);
    }

    activeGesture.pendingDx = 0;
    activeGesture.pendingDy = 0;
    activeGesture.animationFrameId = null;
  }

  function cancelLongPress(activeGesture) {
    if (activeGesture.longPressTimeoutId !== null) {
      window.clearTimeout(activeGesture.longPressTimeoutId);
      activeGesture.longPressTimeoutId = null;
    }
  }

  function limitPointerDelta(value) {
    return Math.max(-MAX_POINTER_DELTA, Math.min(MAX_POINTER_DELTA, value));
  }

  function limitScrollDelta(value) {
    return Math.max(-MAX_SCROLL_DELTA, Math.min(MAX_SCROLL_DELTA, value));
  }
}

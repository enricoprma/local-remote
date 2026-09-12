export interface GestureHandlers {
  onTap: () => void;
  onMove: (dx: number, dy: number) => void;
  onScroll: (dy: number) => void;
  onLongPress: () => void;
  onLongPressCancel: () => void;
  onRightClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}

const LONG_PRESS_THRESHOLD_MS = 450;
const MOVE_THRESHOLD_PX = 8;
const TWO_FINGER_TAP_TIMEOUT_MS = 350;

type Finger = {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
};

type State =
  | { type: "idle" }
  | {
      type: "oneFingerPending";
      finger: Finger;
      pressedAt: number;
    }
  | {
      type: "oneFingerMoving";
      finger: Finger;
    }
  | {
      type: "longPressReady";
      finger: Finger;
    }
  | {
      type: "twoFingerPending";
      firstFinger: Finger;
      secondFinger: Finger;
      firstFingerDownAt: number;
      initialCenterY: number;
    }
  | {
      type: "rightClickPending";
      remainingFinger: Finger;
      firstFingerDownAt: number;
    }
  | {
      type: "twoFingerScrolling";
      firstFinger: Finger;
      secondFinger: Finger;
      lastCenterY: number;
    }
  | {
      type: "threeFingerDragging";
      fingers: [Finger, Finger, Finger];
    }
  | {
      type: "blockedUntilRelease";
      fingerIds: Set<number>;
    };

type GestureEvent = PointerEvent | "longPressThreshold";

/**
 * Recognizes touchpad gestures:
 *
 * - 1 finger: tap or pointer movement
 * - 1 finger held for 450ms: long press on normal release
 * - 2 fingers: right click when tapped, scroll when moved
 * - 3 fingers: drag
 *
 * Two-finger tap timing starts with the first finger.
 *
 * When transitioning from one to two fingers, movement origins are reset so
 * movement before the second contact does not contribute to two-finger scroll.
 *
 * After a multi-finger gesture ends or becomes invalid, remaining contacts are
 * ignored until every finger has been released.
 *
 * Returns a function that cancels the currently active gesture while keeping
 * the recognizer attached.
 */
export function attachGestureRecognizer(
  root: HTMLElement,
  handlers: GestureHandlers,
): () => void {
  root.style.touchAction = "none";

  let state: State = { type: "idle" };
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let longPressTimerGeneration = 0;

  function handleGestureEvent(event: GestureEvent): void {
    switch (state.type) {
      case "idle":
        handleIdle(event);
        return;
      case "oneFingerPending":
        handleOneFingerPending(state, event);
        return;
      case "oneFingerMoving":
        handleOneFingerMoving(state, event);
        return;
      case "longPressReady":
        handleLongPressReady(state, event);
        return;
      case "twoFingerPending":
        handleTwoFingerPending(state, event);
        return;
      case "rightClickPending":
        handleRightClickPending(state, event);
        return;
      case "twoFingerScrolling":
        handleTwoFingerScrolling(state, event);
        return;
      case "threeFingerDragging":
        handleThreeFingerDragging(state, event);
        return;
      case "blockedUntilRelease":
        handleBlockedUntilRelease(state, event);
        return;
    }
  }

  function handleIdle(event: GestureEvent): void {
    if (event === "longPressThreshold" || event.type !== "pointerdown") {
      return;
    }

    state = {
      type: "oneFingerPending",
      finger: fingerFromEvent(event),
      pressedAt: event.timeStamp,
    };

    startLongPressTimer();
  }

  function handleOneFingerPending(
    current: Extract<State, { type: "oneFingerPending" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      state = {
        type: "longPressReady",
        finger: current.finger,
      };
      return;
    }

    if (event.type === "pointerdown") {
      startTwoFingerPending(current.finger, event, current.pressedAt);
      return;
    }

    if (event.pointerId !== current.finger.id) {
      return;
    }

    if (event.type === "pointermove") {
      const finger = updateFingerFromEvent(current.finger, event);

      if (distanceFromStart(finger) < MOVE_THRESHOLD_PX) {
        state = {
          ...current,
          finger,
        };
        return;
      }

      cancelLongPressTimer();

      state = {
        type: "oneFingerMoving",
        finger,
      };

      handlers.onMove(finger.x - finger.startX, finger.y - finger.startY);
      return;
    }

    if (event.type === "pointerup") {
      cancelLongPressTimer();
      state = { type: "idle" };

      const finger = updateFingerFromEvent(current.finger, event);

      if (distanceFromStart(finger) >= MOVE_THRESHOLD_PX) {
        handlers.onMove(finger.x - finger.startX, finger.y - finger.startY);
      } else if (event.timeStamp - current.pressedAt >= LONG_PRESS_THRESHOLD_MS) {
        handlers.onLongPress();
      } else {
        handlers.onTap();
      }

      return;
    }

    if (event.type === "pointercancel") {
      cancelLongPressTimer();
      state = { type: "idle" };
    }
  }

  function handleOneFingerMoving(
    current: Extract<State, { type: "oneFingerMoving" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      return;
    }

    if (event.type === "pointerdown") {
      startTwoFingerScrolling(current.finger, event);
      return;
    }

    if (event.pointerId !== current.finger.id) {
      return;
    }

    if (event.type === "pointermove") {
      const nextFinger = updateFingerFromEvent(current.finger, event);

      state = {
        type: "oneFingerMoving",
        finger: nextFinger,
      };

      handlers.onMove(nextFinger.x - current.finger.x, nextFinger.y - current.finger.y);
      return;
    }

    if (event.type === "pointerup") {
      state = { type: "idle" };

      handlers.onMove(
        event.clientX - current.finger.x,
        event.clientY - current.finger.y,
      );
      return;
    }

    if (event.type === "pointercancel") {
      state = { type: "idle" };
    }
  }

  function handleLongPressReady(
    current: Extract<State, { type: "longPressReady" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      return;
    }

    if (event.type === "pointerdown") {
      startTwoFingerScrolling(current.finger, event);
      handlers.onLongPressCancel();
      return;
    }

    if (event.pointerId !== current.finger.id) {
      return;
    }

    if (event.type === "pointermove") {
      // Once the threshold has been reached, movement no longer changes the
      // classification. The long press commits on normal release.
      state = {
        ...current,
        finger: updateFingerFromEvent(current.finger, event),
      };
      return;
    }

    state = { type: "idle" };

    if (event.type === "pointerup") {
      handlers.onLongPress();
    }

    if (event.type === "pointercancel") {
      handlers.onLongPressCancel();
    }
  }

  function startTwoFingerPending(
    firstFinger: Finger,
    event: PointerEvent,
    firstFingerDownAt: number,
  ): void {
    cancelLongPressTimer();

    // Timing continues from the first contact, while movement starts fresh
    // when the second finger arrives.
    const first = resetMovementStart(firstFinger);
    const second = fingerFromEvent(event);

    state = {
      type: "twoFingerPending",
      firstFinger: first,
      secondFinger: second,
      firstFingerDownAt,
      initialCenterY: fingerCenterY(first, second),
    };
  }

  function handleTwoFingerPending(
    current: Extract<State, { type: "twoFingerPending" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      return;
    }

    if (event.type === "pointerdown") {
      startThreeFingerDragging(current.firstFinger, current.secondFinger, event);
      return;
    }

    if (event.type === "pointercancel") {
      blockTrackedFingersWithout(event.pointerId);
      return;
    }

    if (
      (event.type !== "pointermove" && event.type !== "pointerup") ||
      (event.pointerId !== current.firstFinger.id &&
        event.pointerId !== current.secondFinger.id)
    ) {
      return;
    }

    const firstFinger =
      event.pointerId === current.firstFinger.id
        ? updateFingerFromEvent(current.firstFinger, event)
        : current.firstFinger;

    const secondFinger =
      event.pointerId === current.secondFinger.id
        ? updateFingerFromEvent(current.secondFinger, event)
        : current.secondFinger;

    const centerY = fingerCenterY(firstFinger, secondFinger);

    const moved =
      distanceFromStart(firstFinger) >= MOVE_THRESHOLD_PX ||
      distanceFromStart(secondFinger) >= MOVE_THRESHOLD_PX;

    const withinTapTime =
      event.timeStamp - current.firstFingerDownAt <= TWO_FINGER_TAP_TIMEOUT_MS;

    if (event.type === "pointermove") {
      if (!moved) {
        state = {
          ...current,
          firstFinger,
          secondFinger,
        };
        return;
      }

      state = {
        type: "twoFingerScrolling",
        firstFinger,
        secondFinger,
        lastCenterY: centerY,
      };

      const dy = centerY - current.initialCenterY;

      if (dy !== 0) {
        handlers.onScroll(dy);
      }

      return;
    }

    const remainingFinger =
      event.pointerId === firstFinger.id ? secondFinger : firstFinger;

    if (moved || !withinTapTime) {
      state = {
        type: "blockedUntilRelease",
        fingerIds: new Set([remainingFinger.id]),
      };

      const dy = centerY - current.initialCenterY;

      if (moved && dy !== 0) {
        handlers.onScroll(dy);
      }

      return;
    }

    state = {
      type: "rightClickPending",
      remainingFinger,
      firstFingerDownAt: current.firstFingerDownAt,
    };
  }

  function handleRightClickPending(
    current: Extract<State, { type: "rightClickPending" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      return;
    }

    if (event.type === "pointerdown") {
      state = {
        type: "blockedUntilRelease",
        fingerIds: new Set([current.remainingFinger.id, event.pointerId]),
      };
      return;
    }

    if (event.pointerId !== current.remainingFinger.id) {
      return;
    }

    if (event.type === "pointercancel") {
      state = { type: "idle" };
      return;
    }

    if (event.type !== "pointermove" && event.type !== "pointerup") {
      return;
    }

    const remainingFinger = updateFingerFromEvent(current.remainingFinger, event);
    const moved = distanceFromStart(remainingFinger) >= MOVE_THRESHOLD_PX;
    const withinTapTime =
      event.timeStamp - current.firstFingerDownAt <= TWO_FINGER_TAP_TIMEOUT_MS;

    if (event.type === "pointermove") {
      state =
        moved || !withinTapTime
          ? {
              type: "blockedUntilRelease",
              fingerIds: new Set([remainingFinger.id]),
            }
          : {
              ...current,
              remainingFinger,
            };

      return;
    }

    state = { type: "idle" };

    if (!moved && withinTapTime) {
      handlers.onRightClick();
    }
  }

  function startTwoFingerScrolling(firstFinger: Finger, event: PointerEvent): void {
    cancelLongPressTimer();

    const first = resetMovementStart(firstFinger);
    const second = fingerFromEvent(event);

    state = {
      type: "twoFingerScrolling",
      firstFinger: first,
      secondFinger: second,
      lastCenterY: fingerCenterY(first, second),
    };
  }

  function handleTwoFingerScrolling(
    current: Extract<State, { type: "twoFingerScrolling" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      return;
    }

    if (event.type === "pointerdown") {
      startThreeFingerDragging(current.firstFinger, current.secondFinger, event);
      return;
    }

    if (event.type === "pointercancel") {
      blockTrackedFingersWithout(event.pointerId);
      return;
    }

    if (
      (event.type !== "pointermove" && event.type !== "pointerup") ||
      (event.pointerId !== current.firstFinger.id &&
        event.pointerId !== current.secondFinger.id)
    ) {
      return;
    }

    const firstFinger =
      event.pointerId === current.firstFinger.id
        ? updateFingerFromEvent(current.firstFinger, event)
        : current.firstFinger;

    const secondFinger =
      event.pointerId === current.secondFinger.id
        ? updateFingerFromEvent(current.secondFinger, event)
        : current.secondFinger;

    const centerY = fingerCenterY(firstFinger, secondFinger);
    const dy = centerY - current.lastCenterY;

    if (event.type === "pointermove") {
      state = {
        type: "twoFingerScrolling",
        firstFinger,
        secondFinger,
        lastCenterY: centerY,
      };

      if (dy !== 0) {
        handlers.onScroll(dy);
      }

      return;
    }

    const remainingFingerId =
      event.pointerId === firstFinger.id ? secondFinger.id : firstFinger.id;

    state = {
      type: "blockedUntilRelease",
      fingerIds: new Set([remainingFingerId]),
    };

    if (dy !== 0) {
      handlers.onScroll(dy);
    }
  }

  function startThreeFingerDragging(
    firstFinger: Finger,
    secondFinger: Finger,
    event: PointerEvent,
  ): void {
    state = {
      type: "threeFingerDragging",
      fingers: [firstFinger, secondFinger, fingerFromEvent(event)],
    };

    handlers.onDragStart();
  }

  function handleThreeFingerDragging(
    current: Extract<State, { type: "threeFingerDragging" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      return;
    }

    if (event.type === "pointerdown") {
      state = {
        type: "blockedUntilRelease",
        fingerIds: new Set([
          ...current.fingers.map((finger) => finger.id),
          event.pointerId,
        ]),
      };

      handlers.onDragEnd();
      return;
    }

    const index = current.fingers.findIndex((finger) => finger.id === event.pointerId);

    if (index < 0) {
      return;
    }

    const finger = current.fingers[index];

    // Pointer events arrive one finger at a time. Dividing each contribution
    // makes their accumulated movement follow the three-finger center.
    const dx = (event.clientX - finger.x) / current.fingers.length;
    const dy = (event.clientY - finger.y) / current.fingers.length;

    if (event.type === "pointermove") {
      const fingers = [...current.fingers] as [Finger, Finger, Finger];
      fingers[index] = updateFingerFromEvent(finger, event);

      state = {
        type: "threeFingerDragging",
        fingers,
      };

      if (dx !== 0 || dy !== 0) {
        handlers.onMove(dx, dy);
      }

      return;
    }

    if (event.type === "pointerup" || event.type === "pointercancel") {
      state = {
        type: "blockedUntilRelease",
        fingerIds: new Set(
          current.fingers
            .filter((item) => item.id !== event.pointerId)
            .map((item) => item.id),
        ),
      };

      try {
        if (event.type === "pointerup" && (dx !== 0 || dy !== 0)) {
          handlers.onMove(dx, dy);
        }
      } finally {
        handlers.onDragEnd();
      }
    }
  }

  function handleBlockedUntilRelease(
    current: Extract<State, { type: "blockedUntilRelease" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold" || event.type === "pointermove") {
      return;
    }

    const fingerIds = new Set(current.fingerIds);

    if (event.type === "pointerdown") {
      fingerIds.add(event.pointerId);
    } else if (event.type === "pointerup" || event.type === "pointercancel") {
      fingerIds.delete(event.pointerId);
    } else {
      return;
    }

    state =
      fingerIds.size === 0
        ? { type: "idle" }
        : {
            type: "blockedUntilRelease",
            fingerIds,
          };
  }

  function startLongPressTimer(): void {
    cancelLongPressTimer();

    const generation = longPressTimerGeneration;

    longPressTimer = setTimeout(() => {
      if (generation !== longPressTimerGeneration) {
        return;
      }

      longPressTimer = null;
      handleGestureEvent("longPressThreshold");
    }, LONG_PRESS_THRESHOLD_MS);
  }

  function cancelLongPressTimer(): void {
    longPressTimerGeneration++;

    if (longPressTimer === null) {
      return;
    }

    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function trackedFingerIds(): Set<number> {
    switch (state.type) {
      case "idle":
        return new Set();

      case "oneFingerPending":
      case "oneFingerMoving":
      case "longPressReady":
        return new Set([state.finger.id]);

      case "twoFingerPending":
      case "twoFingerScrolling":
        return new Set([state.firstFinger.id, state.secondFinger.id]);

      case "rightClickPending":
        return new Set([state.remainingFinger.id]);

      case "threeFingerDragging":
        return new Set(state.fingers.map((finger) => finger.id));

      case "blockedUntilRelease":
        return state.fingerIds;
    }
  }

  function blockTrackedFingersWithout(pointerId: number): void {
    const fingerIds = trackedFingerIds();
    fingerIds.delete(pointerId);

    state =
      fingerIds.size === 0
        ? { type: "idle" }
        : {
            type: "blockedUntilRelease",
            fingerIds,
          };
  }

  function cancelActiveGesture(): void {
    const current = state;
    const fingerIds = trackedFingerIds();

    cancelLongPressTimer();

    state =
      fingerIds.size === 0
        ? { type: "idle" }
        : {
            type: "blockedUntilRelease",
            fingerIds,
          };

    if (current.type === "threeFingerDragging") {
      handlers.onDragEnd();
    }

    if (current.type === "longPressReady") {
      handlers.onLongPressCancel();
    }
  }

  function resetGestureState(): void {
    cancelActiveGesture();
    state = { type: "idle" };
  }

  function handlePointerEvent(event: PointerEvent): void {
    const tracked = trackedFingerIds().has(event.pointerId);

    if (event.type === "pointerdown" ? event.button !== 0 || tracked : !tracked) {
      return;
    }

    event.preventDefault();

    if (event.type === "pointerdown") {
      try {
        root.setPointerCapture(event.pointerId);
      } catch {
        cancelActiveGesture();
        return;
      }
    }

    handleGestureEvent(event);
  }

  function handleLostPointerCapture(event: PointerEvent): void {
    if (trackedFingerIds().has(event.pointerId)) {
      cancelActiveGesture();
    }
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === "hidden") {
      resetGestureState();
    }
  }

  root.addEventListener("lostpointercapture", handleLostPointerCapture);

  window.addEventListener("blur", cancelActiveGesture);
  window.addEventListener("pagehide", resetGestureState);
  document.addEventListener("visibilitychange", handleVisibilityChange);

  root.addEventListener("pointerdown", handlePointerEvent);
  window.addEventListener("pointermove", handlePointerEvent);
  window.addEventListener("pointerup", handlePointerEvent);
  window.addEventListener("pointercancel", handlePointerEvent);

  return cancelActiveGesture;
}

function fingerFromEvent(event: PointerEvent): Finger {
  return {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    startX: event.clientX,
    startY: event.clientY,
  };
}

function updateFingerFromEvent(finger: Finger, event: PointerEvent): Finger {
  return {
    ...finger,
    x: event.clientX,
    y: event.clientY,
  };
}

function resetMovementStart(finger: Finger): Finger {
  return {
    ...finger,
    startX: finger.x,
    startY: finger.y,
  };
}

function distanceFromStart(finger: Finger): number {
  return Math.hypot(finger.x - finger.startX, finger.y - finger.startY);
}

function fingerCenterY(firstFinger: Finger, secondFinger: Finger): number {
  return (firstFinger.y + secondFinger.y) / 2;
}
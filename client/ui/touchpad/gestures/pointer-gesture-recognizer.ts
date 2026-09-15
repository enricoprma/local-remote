import type { GestureHandlers, GestureRecognizer } from "./types.js";

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
 * Recognizes touchpad gestures from Pointer Events. One instance owns the
 * listeners and state for exactly one element.
 */
export class PointerGestureRecognizer implements GestureRecognizer {
  readonly #element: HTMLElement;
  readonly #handlers: GestureHandlers;
  readonly #originalTouchAction: string;
  readonly #capturedPointerIds = new Set<number>();
  #state: State = { type: "idle" };
  #longPressTimer: ReturnType<typeof setTimeout> | null = null;
  #longPressTimerGeneration = 0;
  #enabled = false;
  #destroyed = false;
  #changingEnabled = false;

  constructor(element: HTMLElement, handlers: GestureHandlers) {
    this.#element = element;
    this.#handlers = handlers;
    this.#originalTouchAction = element.style.touchAction;
    this.setEnabled(true);
  }

  setEnabled(enabled: boolean): void {
    if (this.#destroyed || this.#changingEnabled || enabled === this.#enabled) {
      return;
    }

    if (!enabled) {
      this.#disable();
      return;
    }

    this.#state = { type: "idle" };
    this.#element.style.touchAction = "none";
    this.#addListeners();
    this.#enabled = true;
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    this.#disable();
  }

  #disable(): void {
    if (!this.#enabled) {
      return;
    }

    this.#changingEnabled = true;
    this.#enabled = false;
    this.#cancelLongPressTimer();

    const wasThreeFingerDragging = this.#state.type === "threeFingerDragging";
    const capturedPointerIds = [...this.#capturedPointerIds];

    this.#state = { type: "idle" };

    try {
      if (wasThreeFingerDragging) {
        this.#handlers.onThreeFingerEnd();
      }
    } finally {
      this.#removeListeners();
      this.#capturedPointerIds.clear();

      for (const pointerId of capturedPointerIds) {
        try {
          this.#element.releasePointerCapture(pointerId);
        } catch {
          // Capture may already have been released by the browser.
        }
      }

      this.#element.style.touchAction = this.#originalTouchAction;
      this.#changingEnabled = false;
    }
  }

  #addListeners(): void {
    this.#element.addEventListener(
      "lostpointercapture",
      this.#handleLostPointerCapture,
    );
    window.addEventListener("blur", this.#handleBlur);
    window.addEventListener("pagehide", this.#handlePageHide);
    document.addEventListener("visibilitychange", this.#handleVisibilityChange);
    this.#element.addEventListener("pointerdown", this.#handlePointerEvent);
    window.addEventListener("pointermove", this.#handlePointerEvent);
    window.addEventListener("pointerup", this.#handlePointerEvent);
    window.addEventListener("pointercancel", this.#handlePointerEvent);
  }

  #removeListeners(): void {
    this.#element.removeEventListener(
      "lostpointercapture",
      this.#handleLostPointerCapture,
    );
    window.removeEventListener("blur", this.#handleBlur);
    window.removeEventListener("pagehide", this.#handlePageHide);
    document.removeEventListener(
      "visibilitychange",
      this.#handleVisibilityChange,
    );
    this.#element.removeEventListener("pointerdown", this.#handlePointerEvent);
    window.removeEventListener("pointermove", this.#handlePointerEvent);
    window.removeEventListener("pointerup", this.#handlePointerEvent);
    window.removeEventListener("pointercancel", this.#handlePointerEvent);
  }

  readonly #handlePointerEvent = (event: PointerEvent): void => {
    if (!this.#enabled) {
      return;
    }

    const tracked = this.#trackedFingerIds().has(event.pointerId);

    if (
      event.type === "pointerdown" ? event.button !== 0 || tracked : !tracked
    ) {
      return;
    }

    event.preventDefault();

    if (event.type === "pointerdown") {
      try {
        this.#element.setPointerCapture(event.pointerId);
        this.#capturedPointerIds.add(event.pointerId);
      } catch {
        this.#cancelActiveGesture(false);
        return;
      }
    }

    try {
      this.#handleGestureEvent(event);
    } finally {
      if (event.type === "pointerup" || event.type === "pointercancel") {
        this.#capturedPointerIds.delete(event.pointerId);
      }
    }
  };

  readonly #handleLostPointerCapture = (event: PointerEvent): void => {
    this.#capturedPointerIds.delete(event.pointerId);

    if (this.#enabled && this.#trackedFingerIds().has(event.pointerId)) {
      this.#cancelActiveGesture(false);
    }
  };

  readonly #handleBlur = (): void => {
    this.#cancelActiveGesture(false);
  };

  readonly #handlePageHide = (): void => {
    this.#cancelActiveGesture(true);
  };

  readonly #handleVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      this.#cancelActiveGesture(true);
    }
  };

  #handleGestureEvent(event: GestureEvent): void {
    switch (this.#state.type) {
      case "idle":
        this.#handleIdle(event);
        return;
      case "oneFingerPending":
        this.#handleOneFingerPending(this.#state, event);
        return;
      case "oneFingerMoving":
        this.#handleOneFingerMoving(this.#state, event);
        return;
      case "longPressReady":
        this.#handleLongPressReady(this.#state, event);
        return;
      case "twoFingerPending":
        this.#handleTwoFingerPending(this.#state, event);
        return;
      case "rightClickPending":
        this.#handleRightClickPending(this.#state, event);
        return;
      case "twoFingerScrolling":
        this.#handleTwoFingerScrolling(this.#state, event);
        return;
      case "threeFingerDragging":
        this.#handleThreeFingerDragging(this.#state, event);
        return;
      case "blockedUntilRelease":
        this.#handleBlockedUntilRelease(this.#state, event);
        return;
    }
  }

  #handleIdle(event: GestureEvent): void {
    if (event === "longPressThreshold" || event.type !== "pointerdown") {
      return;
    }

    this.#state = {
      type: "oneFingerPending",
      finger: fingerFromEvent(event),
      pressedAt: event.timeStamp,
    };

    this.#startLongPressTimer();
  }

  #handleOneFingerPending(
    current: Extract<State, { type: "oneFingerPending" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      this.#state = {
        type: "longPressReady",
        finger: current.finger,
      };
      return;
    }

    if (event.type === "pointerdown") {
      this.#startTwoFingerPending(current.finger, event, current.pressedAt);
      return;
    }

    if (event.pointerId !== current.finger.id) {
      return;
    }

    if (event.type === "pointermove") {
      const finger = updateFingerFromEvent(current.finger, event);

      if (distanceFromStart(finger) < MOVE_THRESHOLD_PX) {
        this.#state = {
          ...current,
          finger,
        };
        return;
      }

      this.#cancelLongPressTimer();
      this.#state = {
        type: "oneFingerMoving",
        finger,
      };
      this.#handlers.onOneFingerMove(
        finger.x - finger.startX,
        finger.y - finger.startY,
      );
      return;
    }

    if (event.type === "pointerup") {
      this.#cancelLongPressTimer();
      this.#state = { type: "idle" };

      const finger = updateFingerFromEvent(current.finger, event);

      if (distanceFromStart(finger) >= MOVE_THRESHOLD_PX) {
        this.#handlers.onOneFingerMove(
          finger.x - finger.startX,
          finger.y - finger.startY,
        );
      } else if (
        event.timeStamp - current.pressedAt >=
        LONG_PRESS_THRESHOLD_MS
      ) {
        this.#handlers.onLongPress();
      } else {
        this.#handlers.onTap();
      }

      return;
    }

    if (event.type === "pointercancel") {
      this.#cancelLongPressTimer();
      this.#state = { type: "idle" };
    }
  }

  #handleOneFingerMoving(
    current: Extract<State, { type: "oneFingerMoving" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      return;
    }

    if (event.type === "pointerdown") {
      this.#startTwoFingerScrolling(current.finger, event);
      return;
    }

    if (event.pointerId !== current.finger.id) {
      return;
    }

    if (event.type === "pointermove") {
      const nextFinger = updateFingerFromEvent(current.finger, event);

      this.#state = {
        type: "oneFingerMoving",
        finger: nextFinger,
      };
      this.#handlers.onOneFingerMove(
        nextFinger.x - current.finger.x,
        nextFinger.y - current.finger.y,
      );
      return;
    }

    if (event.type === "pointerup") {
      this.#state = { type: "idle" };
      this.#handlers.onOneFingerMove(
        event.clientX - current.finger.x,
        event.clientY - current.finger.y,
      );
      return;
    }

    if (event.type === "pointercancel") {
      this.#state = { type: "idle" };
    }
  }

  #handleLongPressReady(
    current: Extract<State, { type: "longPressReady" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      return;
    }

    if (event.type === "pointerdown") {
      this.#startTwoFingerScrolling(current.finger, event);
      return;
    }

    if (event.pointerId !== current.finger.id) {
      return;
    }

    if (event.type === "pointermove") {
      this.#state = {
        ...current,
        finger: updateFingerFromEvent(current.finger, event),
      };
      return;
    }

    this.#state = { type: "idle" };

    if (event.type === "pointerup") {
      this.#handlers.onLongPress();
    }
  }

  #startTwoFingerPending(
    firstFinger: Finger,
    event: PointerEvent,
    firstFingerDownAt: number,
  ): void {
    this.#cancelLongPressTimer();

    const first = resetMovementStart(firstFinger);
    const second = fingerFromEvent(event);

    this.#state = {
      type: "twoFingerPending",
      firstFinger: first,
      secondFinger: second,
      firstFingerDownAt,
      initialCenterY: fingerCenterY(first, second),
    };
  }

  #handleTwoFingerPending(
    current: Extract<State, { type: "twoFingerPending" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      return;
    }

    if (event.type === "pointerdown") {
      this.#startThreeFingerDragging(
        current.firstFinger,
        current.secondFinger,
        event,
      );
      return;
    }

    if (event.type === "pointercancel") {
      this.#blockTrackedFingersWithout(event.pointerId);
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
        this.#state = {
          ...current,
          firstFinger,
          secondFinger,
        };
        return;
      }

      this.#state = {
        type: "twoFingerScrolling",
        firstFinger,
        secondFinger,
        lastCenterY: centerY,
      };

      const dy = centerY - current.initialCenterY;

      if (dy !== 0) {
        this.#handlers.onTwoFingerMove(dy);
      }

      return;
    }

    const remainingFinger =
      event.pointerId === firstFinger.id ? secondFinger : firstFinger;

    if (moved || !withinTapTime) {
      this.#state = {
        type: "blockedUntilRelease",
        fingerIds: new Set([remainingFinger.id]),
      };

      const dy = centerY - current.initialCenterY;

      if (moved && dy !== 0) {
        this.#handlers.onTwoFingerMove(dy);
      }

      return;
    }

    this.#state = {
      type: "rightClickPending",
      remainingFinger,
      firstFingerDownAt: current.firstFingerDownAt,
    };
  }

  #handleRightClickPending(
    current: Extract<State, { type: "rightClickPending" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      return;
    }

    if (event.type === "pointerdown") {
      this.#state = {
        type: "blockedUntilRelease",
        fingerIds: new Set([current.remainingFinger.id, event.pointerId]),
      };
      return;
    }

    if (event.pointerId !== current.remainingFinger.id) {
      return;
    }

    if (event.type === "pointercancel") {
      this.#state = { type: "idle" };
      return;
    }

    if (event.type !== "pointermove" && event.type !== "pointerup") {
      return;
    }

    const remainingFinger = updateFingerFromEvent(
      current.remainingFinger,
      event,
    );
    const moved = distanceFromStart(remainingFinger) >= MOVE_THRESHOLD_PX;
    const withinTapTime =
      event.timeStamp - current.firstFingerDownAt <= TWO_FINGER_TAP_TIMEOUT_MS;

    if (event.type === "pointermove") {
      this.#state =
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

    this.#state = { type: "idle" };

    if (!moved && withinTapTime) {
      this.#handlers.onTwoFingerTap();
    }
  }

  #startTwoFingerScrolling(firstFinger: Finger, event: PointerEvent): void {
    this.#cancelLongPressTimer();

    const first = resetMovementStart(firstFinger);
    const second = fingerFromEvent(event);

    this.#state = {
      type: "twoFingerScrolling",
      firstFinger: first,
      secondFinger: second,
      lastCenterY: fingerCenterY(first, second),
    };
  }

  #handleTwoFingerScrolling(
    current: Extract<State, { type: "twoFingerScrolling" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      return;
    }

    if (event.type === "pointerdown") {
      this.#startThreeFingerDragging(
        current.firstFinger,
        current.secondFinger,
        event,
      );
      return;
    }

    if (event.type === "pointercancel") {
      this.#blockTrackedFingersWithout(event.pointerId);
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
      this.#state = {
        type: "twoFingerScrolling",
        firstFinger,
        secondFinger,
        lastCenterY: centerY,
      };

      if (dy !== 0) {
        this.#handlers.onTwoFingerMove(dy);
      }

      return;
    }

    const remainingFingerId =
      event.pointerId === firstFinger.id ? secondFinger.id : firstFinger.id;

    this.#state = {
      type: "blockedUntilRelease",
      fingerIds: new Set([remainingFingerId]),
    };

    if (dy !== 0) {
      this.#handlers.onTwoFingerMove(dy);
    }
  }

  #startThreeFingerDragging(
    firstFinger: Finger,
    secondFinger: Finger,
    event: PointerEvent,
  ): void {
    this.#state = {
      type: "threeFingerDragging",
      fingers: [firstFinger, secondFinger, fingerFromEvent(event)],
    };
    this.#handlers.onThreeFingerStart();
  }

  #handleThreeFingerDragging(
    current: Extract<State, { type: "threeFingerDragging" }>,
    event: GestureEvent,
  ): void {
    if (event === "longPressThreshold") {
      return;
    }

    if (event.type === "pointerdown") {
      this.#finishThreeFingerGesture({
        type: "blockedUntilRelease",
        fingerIds: new Set([
          ...current.fingers.map((finger) => finger.id),
          event.pointerId,
        ]),
      });
      return;
    }

    const index = current.fingers.findIndex(
      (finger) => finger.id === event.pointerId,
    );

    if (index < 0) {
      return;
    }

    const finger = current.fingers[index];
    const dx = (event.clientX - finger.x) / current.fingers.length;
    const dy = (event.clientY - finger.y) / current.fingers.length;

    if (event.type === "pointermove") {
      const fingers = [...current.fingers] as [Finger, Finger, Finger];
      fingers[index] = updateFingerFromEvent(finger, event);

      this.#state = {
        type: "threeFingerDragging",
        fingers,
      };

      if (dx !== 0 || dy !== 0) {
        this.#handlers.onThreeFingerMove(dx, dy);
      }

      return;
    }

    if (event.type === "pointerup" || event.type === "pointercancel") {
      const nextState: State = {
        type: "blockedUntilRelease",
        fingerIds: new Set(
          current.fingers
            .filter((item) => item.id !== event.pointerId)
            .map((item) => item.id),
        ),
      };

      if (event.type === "pointerup" && (dx !== 0 || dy !== 0)) {
        this.#finishThreeFingerGesture(nextState, { dx, dy });
      } else {
        this.#finishThreeFingerGesture(nextState);
      }
    }
  }

  #finishThreeFingerGesture(
    nextState: State,
    finalMove?: { dx: number; dy: number },
  ): void {
    if (this.#state.type !== "threeFingerDragging") {
      return;
    }

    this.#state = nextState;

    try {
      if (finalMove) {
        this.#handlers.onThreeFingerMove(finalMove.dx, finalMove.dy);
      }
    } finally {
      this.#handlers.onThreeFingerEnd();
    }
  }

  #handleBlockedUntilRelease(
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

    this.#state =
      fingerIds.size === 0
        ? { type: "idle" }
        : {
            type: "blockedUntilRelease",
            fingerIds,
          };
  }

  #startLongPressTimer(): void {
    this.#cancelLongPressTimer();

    const generation = this.#longPressTimerGeneration;

    this.#longPressTimer = setTimeout(() => {
      if (
        generation !== this.#longPressTimerGeneration ||
        !this.#enabled ||
        this.#destroyed
      ) {
        return;
      }

      this.#longPressTimer = null;
      this.#handleGestureEvent("longPressThreshold");
    }, LONG_PRESS_THRESHOLD_MS);
  }

  #cancelLongPressTimer(): void {
    this.#longPressTimerGeneration++;

    if (this.#longPressTimer === null) {
      return;
    }

    clearTimeout(this.#longPressTimer);
    this.#longPressTimer = null;
  }

  #trackedFingerIds(): Set<number> {
    switch (this.#state.type) {
      case "idle":
        return new Set();
      case "oneFingerPending":
      case "oneFingerMoving":
      case "longPressReady":
        return new Set([this.#state.finger.id]);
      case "twoFingerPending":
      case "twoFingerScrolling":
        return new Set([
          this.#state.firstFinger.id,
          this.#state.secondFinger.id,
        ]);
      case "rightClickPending":
        return new Set([this.#state.remainingFinger.id]);
      case "threeFingerDragging":
        return new Set(this.#state.fingers.map((finger) => finger.id));
      case "blockedUntilRelease":
        return new Set(this.#state.fingerIds);
    }
  }

  #blockTrackedFingersWithout(pointerId: number): void {
    const fingerIds = this.#trackedFingerIds();
    fingerIds.delete(pointerId);

    this.#state =
      fingerIds.size === 0
        ? { type: "idle" }
        : {
            type: "blockedUntilRelease",
            fingerIds,
          };
  }

  #cancelActiveGesture(resetToIdle: boolean): void {
    if (!this.#enabled) {
      return;
    }

    const wasThreeFingerDragging = this.#state.type === "threeFingerDragging";
    const fingerIds = this.#trackedFingerIds();

    this.#cancelLongPressTimer();
    this.#state =
      resetToIdle || fingerIds.size === 0
        ? { type: "idle" }
        : {
            type: "blockedUntilRelease",
            fingerIds,
          };

    if (wasThreeFingerDragging) {
      this.#handlers.onThreeFingerEnd();
    }
  }
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

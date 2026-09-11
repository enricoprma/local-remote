// ============================================================
// Gesture map
// ============================================================
//
//                      ┌──────────┐
//                      │   IDLE   │
//                      └────┬─────┘
//                           │ pointerdown
//                           ▼
//                    ┌─────────────┐
//               ┌────│ ONE FINGER │───────┐
//               │    └──────┬──────┘       │
//               │           │              │
//            movement      hold         pointerup
//               │           │              │
//               ▼           ▼              ▼
//            MOVING     LONG PRESS         TAP
//
//                    second pointerdown
//                           │
//                           ▼
//                    ┌─────────────┐
//                    │ TWO FINGERS │
//                    └──────┬──────┘
//                       ┌───┴────┐
//                       │        │
//                     move    pointerup
//                       │        │
//                       ▼        ▼
//                    SCROLL   RIGHT CLICK
//
//
//     TWO FINGERS → third pointerdown → DRAGGING
//                                │
//                         ┌──────┴──────┐
//                         │             │
//                       move        pointerup
//                         │             │
//                         ▼             ▼
//                      onMove       onDragEnd
//
//
// Dragging begins with onDragStart().
//
// Important:
// - States describe gestures.
// - Callbacks describe what the gesture recognizer discovered.
// - This file knows nothing about RobotJS.
// - It does not know what mouseToggle(), dragMouse(), etc. are.

// ============================================================
// Public API
// ============================================================

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

// ============================================================
// Configuration
// ============================================================

const HOLD_MS = 450;
const MOVE_THRESHOLD = 8;

const TWO_FINGER_TAP_MS = 350;

// ============================================================
// State
// ============================================================

type Finger = {
  id: number;

  x: number;
  y: number;

  startX: number;
  startY: number;
};

type State =
  | {
      type: "idle";
    }
  | {
      type: "oneFinger";
      finger: Finger;
      startedAt: number;
    }
  | {
      type: "moving";
      finger: Finger;
    }
  | {
      type: "longPress";
      finger: Finger;
    }
  | {
      type: "twoFingers";

      first: Finger;
      second: Finger;

      startedAt: number;

      startCenterY: number;
      lastCenterY: number;

      moved: boolean;
      releasedFingerId: number | null;
    }
  | {
      type: "dragging";
      fingers: Finger[];
    }
  | {
      // Unsupported / ambiguous gesture.
      //
      // We ignore everything until all involved fingers
      // have left the screen.
      type: "blocked";
      fingers: Set<number>;
    };

// Browser PointerEvents go directly into the machine.
//
// "hold" is the only synthetic event we create ourselves,
// because browsers don't emit a long-press event.
type GestureEvent = PointerEvent | "hold";

// ============================================================
// Mount
// ============================================================

export function mountGestures(
  root: HTMLElement,
  {
    onTap,
    onMove,
    onScroll,
    onLongPress,
    onLongPressCancel,
    onRightClick,
    onDragStart,
    onDragEnd,
  }: GestureHandlers,
): () => void {
  // Prevent the browser from turning our touch gestures
  // into native scrolling / zooming.
  root.style.touchAction = "none";

  let state: State = {
    type: "idle",
  };

  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let holdGeneration = 0;

  // ==========================================================
  // Hold timer
  // ==========================================================

  function startHoldTimer(): void {
    cancelHoldTimer();
    const generation = holdGeneration;

    holdTimer = setTimeout(() => {
      if (generation !== holdGeneration) return;
      holdTimer = null;
      handle("hold");
    }, HOLD_MS);
  }

  function cancelHoldTimer(): void {
    holdGeneration++;
    if (holdTimer === null) {
      return;
    }

    clearTimeout(holdTimer);
    holdTimer = null;
  }

  // ==========================================================
  // State machine
  // ==========================================================

  function handle(event: GestureEvent): void {
    switch (state.type) {
      case "idle":
        handleIdle(event);
        return;

      case "oneFinger":
        handleOneFinger(state, event);
        return;

      case "moving":
        handleMoving(state, event);
        return;

      case "longPress":
        handleLongPress(state, event);
        return;

      case "twoFingers":
        handleTwoFingers(state, event);
        return;

      case "dragging":
        handleDragging(state, event);
        return;

      case "blocked":
        handleBlocked(state, event);
        return;
    }
  }

  // ==========================================================
  // IDLE
  //
  // Waiting for the first finger.
  // ==========================================================

  function handleIdle(
    event: GestureEvent,
  ): void {
    if (event === "hold") {
      return;
    }

    if (event.type !== "pointerdown") {
      return;
    }

    const finger = fingerFrom(event);

    state = {
      type: "oneFinger",
      finger,
      startedAt: event.timeStamp,
    };

    startHoldTimer();
  }

  // ==========================================================
  // ONE FINGER
  //
  // We don't yet know which gesture this will become.
  //
  // pointerup    -> tap
  // movement     -> cursor movement
  // hold         -> long press
  // second down  -> two-finger gesture
  // ==========================================================

  function handleOneFinger(
    current: Extract<State, { type: "oneFinger" }>,
    event: GestureEvent,
  ): void {
    // --------------------------------------------------------
    // HOLD
    // --------------------------------------------------------

    if (event === "hold") {
      state = {
        type: "longPress",
        finger: current.finger,
      };

      // Open text entry on pointerup, preserving the browser user gesture
      // and leaving the input open after the finger is released.

      return;
    }

    const isOurFinger =
      event.pointerId === current.finger.id;

    // --------------------------------------------------------
    // MOVEMENT
    // --------------------------------------------------------

    if (
      event.type === "pointermove" &&
      isOurFinger
    ) {
      const finger = moveFinger(
        current.finger,
        event,
      );

      // Small movement is normal finger wobble.
      //
      // Until the threshold is crossed, this may still
      // become a tap or long press.
      if (
        distanceFromStart(finger) <
        MOVE_THRESHOLD
      ) {
        state = {
          ...current,
          finger,
        };

        return;
      }

      cancelHoldTimer();

      state = {
        type: "moving",
        finger,
      };

      // Include the movement accumulated while we were
      // deciding whether this was a tap or a move.
      onMove(
        finger.x - finger.startX,
        finger.y - finger.startY,
      );

      return;
    }

    // --------------------------------------------------------
    // SECOND FINGER
    // --------------------------------------------------------

    if (event.type === "pointerdown") {
      startTwoFingers(current.finger, event, current.startedAt);
      return;
    }

    // --------------------------------------------------------
    // RELEASE -> TAP
    // --------------------------------------------------------

    if (
      event.type === "pointerup" &&
      isOurFinger
    ) {
      cancelHoldTimer();

      state = {
        type: "idle",
      };

      // A browser may report the final position only on pointerup.
      const finger = moveFinger(current.finger, event);
      if (distanceFromStart(finger) >= MOVE_THRESHOLD) {
        onMove(finger.x - finger.startX, finger.y - finger.startY);
        return;
      }

      // The timer may be delayed behind pointerup. Finish the hold here.
      if (event.timeStamp - current.startedAt >= HOLD_MS) {
        onLongPress();
        return;
      }

      onTap();

      return;
    }

    // --------------------------------------------------------
    // CANCEL
    // --------------------------------------------------------

    if (
      event.type === "pointercancel" &&
      isOurFinger
    ) {
      cancelHoldTimer();

      state = {
        type: "idle",
      };
    }
  }

  // ==========================================================
  // MOVING
  //
  // One finger is controlling pointer movement.
  // ==========================================================

  function handleMoving(
    current: Extract<State, { type: "moving" }>,
    event: GestureEvent,
  ): void {
    if (event === "hold") {
      return;
    }

    if (
      event.type === "pointermove" &&
      event.pointerId === current.finger.id
    ) {
      const next = moveFinger(
        current.finger,
        event,
      );

      state = {
        type: "moving",
        finger: next,
      };

      onMove(
        next.x - current.finger.x,
        next.y - current.finger.y,
      );

      return;
    }

    if (
      (
        event.type === "pointerup" ||
        event.type === "pointercancel"
      ) &&
      event.pointerId === current.finger.id
    ) {
      state = {
        type: "idle",
      };

      if (event.type === "pointerup") {
        onMove(event.clientX - current.finger.x, event.clientY - current.finger.y);
      }

      return;
    }

    // Allow a third finger to start dragging even if the first finger
    // moved while the others were being placed. This cannot be a tap.
    if (event.type === "pointerdown") {
      startTwoFingers(current.finger, event, event.timeStamp, true);
    }
  }

  // ==========================================================
  // LONG PRESS
  //
  // Active until the original finger disappears.
  // ==========================================================

  function handleLongPress(
    current: Extract<State, { type: "longPress" }>,
    event: GestureEvent,
  ): void {
    if (event === "hold") {
      return;
    }

    if (event.type === "pointermove") {
      state = { ...current, finger: moveFinger(current.finger, event) };
      return;
    }

    if (
      (
        event.type === "pointerup" ||
        event.type === "pointercancel"
      ) &&
      event.pointerId === current.finger.id
    ) {
      state = {
        type: "idle",
      };

      if (event.type === "pointerup") {
        onLongPress();
      } else {
        onLongPressCancel();
      }

      return;
    }

    // A second finger cancels the long press.
    if (event.type === "pointerdown") {
      startTwoFingers(current.finger, event, event.timeStamp, true);
      onLongPressCancel();
    }
  }

  // ==========================================================
  // TWO FINGERS
  //
  // stationary + quick release -> right click
  // movement                   -> scroll
  // third pointerdown          -> drag
  // ==========================================================

  function startTwoFingers(
    finger: Finger,
    event: PointerEvent,
    startedAt: number,
    moved = false,
  ): void {
    cancelHoldTimer();
    // Earlier one-finger movement must not shift the scroll origin.
    const first = resetStart(finger);
    const second = fingerFrom(event);
    const centerY = fingerCenterY(first, second);
    state = {
      type: "twoFingers",
      first,
      second,
      startedAt,
      startCenterY: centerY,
      lastCenterY: centerY,
      moved,
      releasedFingerId: null,
    };
  }

  function handleTwoFingers(
    current: Extract<State, { type: "twoFingers" }>,
    event: GestureEvent,
  ): void {
    if (event === "hold") return;

    if (event.type === "pointerdown") {
      if (current.releasedFingerId === null) {
        state = {
          type: "dragging",
          fingers: [current.first, current.second, fingerFrom(event)],
        };
        onDragStart();
        return;
      }

      const fingers = trackedFingers();
      fingers.add(event.pointerId);
      state = { type: "blocked", fingers };
      return;
    }

    if (event.type === "pointercancel") {
      const fingers = trackedFingers();
      fingers.delete(event.pointerId);
      state = fingers.size === 0 ? { type: "idle" } : { type: "blocked", fingers };
      return;
    }

    if (event.type !== "pointermove" && event.type !== "pointerup") return;

    const first = event.pointerId === current.first.id
      ? moveFinger(current.first, event) : current.first;
    const second = event.pointerId === current.second.id
      ? moveFinger(current.second, event) : current.second;
    const centerY = fingerCenterY(first, second);
    const moved = current.moved ||
      distanceFromStart(first) >= MOVE_THRESHOLD ||
      distanceFromStart(second) >= MOVE_THRESHOLD;
    const withinTapTime = event.timeStamp - current.startedAt <= TWO_FINGER_TAP_MS;

    state = { ...current, first, second, moved, lastCenterY: centerY };

    // Both fingers must finish a short, stationary gesture. Once one lifts,
    // the remaining finger can only complete or cancel the right-click.
    if (current.releasedFingerId !== null) {
      if (event.type === "pointerup") {
        state = { type: "idle" };
        if (!moved && withinTapTime) onRightClick();
      } else if (moved || !withinTapTime) {
        state = { type: "blocked", fingers: new Set([event.pointerId]) };
      }
      return;
    }

    const dy = current.moved
      ? centerY - current.lastCenterY
      : centerY - current.startCenterY;

    if (event.type === "pointerup") {
      const remainingId = event.pointerId === first.id ? second.id : first.id;
      state = moved || !withinTapTime
        ? { type: "blocked", fingers: new Set([remainingId]) }
        : { ...state, releasedFingerId: event.pointerId };
    }

    // Preserve the existing scroll direction; UI scaling stays in gestures.ts.
    if (moved && dy !== 0) onScroll(dy);
  }

  // ==========================================================
  // DRAGGING
  //
  // Started by:
  //
  // third finger touches down while two fingers are still held
  //
  // Drag state emits:
  //
  // enter    -> onDragStart()
  // movement -> onMove(dx, dy)
  // any release / cancellation / fourth finger -> onDragEnd()
  //
  // The gesture layer does NOT decide how native dragging
  // works. That's the responsibility of the input backend.
  // ==========================================================

  function handleDragging(
    current: Extract<State, { type: "dragging" }>,
    event: GestureEvent,
  ): void {
    if (event === "hold") return;

    if (event.type === "pointerdown") {
      const fingers = trackedFingers();
      fingers.add(event.pointerId);
      state = { type: "blocked", fingers };
      onDragEnd();
      return;
    }

    const finger = current.fingers.find(finger => finger.id === event.pointerId);
    if (!finger) return;

    // One event updates one finger. This is the change of the three-finger
    // center, so moving all three together preserves the normal pointer speed.
    const dx = (event.clientX - finger.x) / current.fingers.length;
    const dy = (event.clientY - finger.y) / current.fingers.length;

    if (event.type === "pointermove") {
      state = {
        ...current,
        fingers: current.fingers.map(finger =>
          finger.id === event.pointerId ? moveFinger(finger, event) : finger),
      };
      if (dx !== 0 || dy !== 0) onMove(dx, dy);
      return;
    }

    if (event.type === "pointerup" || event.type === "pointercancel") {
      state = {
        type: "blocked",
        fingers: new Set(current.fingers
          .filter(finger => finger.id !== event.pointerId)
          .map(finger => finger.id)),
      };
      try {
        // Include the release position before ending drag, without changing
        // the center to that of the two remaining fingers.
        if (event.type === "pointerup" && (dx !== 0 || dy !== 0)) onMove(dx, dy);
      } finally {
        onDragEnd();
      }
    }
  }

  // ==========================================================
  // BLOCKED
  //
  // Ignore everything until every involved finger has gone.
  // ==========================================================

  function handleBlocked(
    current: Extract<State, { type: "blocked" }>,
    event: GestureEvent,
  ): void {
    if (event === "hold") {
      return;
    }

    if (event.type === "pointerdown") {
      const fingers =
        new Set(current.fingers);

      fingers.add(
        event.pointerId,
      );

      state = {
        type: "blocked",
        fingers,
      };

      return;
    }

    if (
      event.type === "pointerup" ||
      event.type === "pointercancel"
    ) {
      const fingers =
        new Set(current.fingers);

      fingers.delete(
        event.pointerId,
      );

      state =
        fingers.size === 0
          ? {
              type: "idle",
            }
          : {
              type: "blocked",
              fingers,
            };
    }
  }

  // ==========================================================
  // Browser events
  //
  // There is deliberately no translation layer here.
  // PointerEvents go directly into the state machine.
  // ==========================================================

  function handlePointerEvent(
    event: PointerEvent,
  ): void {
    const tracked = trackedFingers().has(event.pointerId);
    if (event.type === "pointerdown" ? event.button !== 0 || tracked : !tracked) {
      return;
    }

    event.preventDefault();

    if (
      event.type === "pointerdown"
    ) {
      try {
        root.setPointerCapture(
          event.pointerId,
        );
      } catch {
        // Don't arm a hold for a pointer whose lifetime we cannot capture.
        cancelGesture();
        return;
      }
    }

    handle(event);
  }

  function trackedFingers(): Set<number> {
    switch (state.type) {
      case "idle": return new Set();
      case "oneFinger":
      case "moving":
      case "longPress": return new Set([state.finger.id]);
      case "dragging": return new Set(state.fingers.map(finger => finger.id));
      case "twoFingers": {
        const { first, second, releasedFingerId } = state;
        return new Set([first.id, second.id].filter(id => id !== releasedFingerId));
      }
      case "blocked": return state.fingers;
    }
  }

  function cancelGesture(): void {
    const current = state;
    const fingers = trackedFingers();
    cancelHoldTimer();
    state = fingers.size === 0 ? { type: "idle" } : { type: "blocked", fingers };
    if (current.type === "dragging") onDragEnd();
    if (current.type === "longPress") onLongPressCancel();
  }

  function resetGestures(): void {
    cancelGesture();
    // A hidden/unloaded page may never receive the remaining releases.
    state = { type: "idle" };
  }

  root.addEventListener("lostpointercapture", (event) => {
    // Normal capture release follows pointerup, whose ID is already gone.
    if (trackedFingers().has(event.pointerId)) cancelGesture();
  });
  window.addEventListener("blur", cancelGesture);
  window.addEventListener("pagehide", resetGestures);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") resetGestures();
  });

  root.addEventListener(
    "pointerdown",
    handlePointerEvent,
  );

  window.addEventListener(
    "pointermove",
    handlePointerEvent,
  );

  window.addEventListener(
    "pointerup",
    handlePointerEvent,
  );

  window.addEventListener(
    "pointercancel",
    handlePointerEvent,
  );

  return cancelGesture;
}

// ============================================================
// Geometry helpers
// ============================================================

function fingerFrom(
  event: PointerEvent,
): Finger {
  return {
    id: event.pointerId,

    x: event.clientX,
    y: event.clientY,

    startX: event.clientX,
    startY: event.clientY,
  };
}

function moveFinger(
  finger: Finger,
  event: PointerEvent,
): Finger {
  return {
    ...finger,

    x: event.clientX,
    y: event.clientY,
  };
}

function resetStart(
  finger: Finger,
): Finger {
  return {
    ...finger,

    startX: finger.x,
    startY: finger.y,
  };
}

function distanceFromStart(
  finger: Finger,
): number {
  return Math.hypot(
    finger.x - finger.startX,
    finger.y - finger.startY,
  );
}

function fingerCenterY(
  first: Finger,
  second: Finger,
): number {
  return (
    first.y + second.y
  ) / 2;
}


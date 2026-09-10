const TAP_DISTANCE = 12;
const LONG_PRESS_MS = 500;

const POINTER_SENSITIVITY = 4;
const SCROLL_SENSITIVITY = 5;

const MAX_POINTER_MOVE = 500;
const MAX_SCROLL = 20;

interface PointerPosition {
  x: number;
  y: number;
}

interface PrimaryPointer {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

type GestureMode =
  | "idle"
  | "pointer"
  | "longpress"
  | "scroll"
  | "blocked";

export interface GestureHandlers {
  onTap: () => void;
  onMove: (dx: number, dy: number) => void;
  onScroll: (dy: number) => void;
  onLongPress: () => void;
  onLongPressCancel: () => void;
}

export function mountGestures(
  root: HTMLElement,
  {
    onTap,
    onMove,
    onScroll,
  onLongPress,
  onLongPressCancel,
  }: GestureHandlers,
): void {
  const touchArea = requiredElement(root, "#touch-area", HTMLElement);
  const pointers = new Map<number, PointerPosition>();

  let mode: GestureMode = "idle";
  let primary: PrimaryPointer | null = null;

  let longPressTimer: number | null = null;

  let lastScrollY = 0;
  let scrollRemainder = 0;

  touchArea.addEventListener("pointerdown", pointerDown);
  touchArea.addEventListener("pointermove", pointerMove);
  touchArea.addEventListener("pointerup", pointerUp);
  touchArea.addEventListener("pointercancel", pointerCancel);

  function pointerDown(event: PointerEvent): void {
    if (event.button !== 0 || pointers.has(event.pointerId)) {
      return;
    }

    event.preventDefault();

    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });

    touchArea.setPointerCapture(event.pointerId);

    if (mode === "blocked") {
      return;
    }

    if (pointers.size === 1) {
      startPointer(event);
      return;
    }

    if (pointers.size === 2 && mode === "pointer") {
      startScroll();
      return;
    }

    if (pointers.size === 2 && mode === "longpress") {
      onLongPressCancel();
      blockGesture();
      return;
    }

    blockGesture();
  }

  function pointerMove(event: PointerEvent): void {
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

  function pointerUp(event: PointerEvent): void {
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
      onLongPress();
      primary = null;
      mode = "idle";
    } else if (mode === "scroll") {
      moveScroll();
      mode = "blocked";
    }

    pointers.delete(event.pointerId);

    if (mode === "blocked" && pointers.size === 0) {
      mode = "idle";
    }
  }

  function pointerCancel(event: PointerEvent): void {
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

  function startPointer(event: PointerEvent): void {
    mode = "pointer";

    primary = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
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
    }, LONG_PRESS_MS);
  }

  function movePointer(event: PointerEvent): void {
    if (!primary) {
      return;
    }

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

  function finishPointer(event: PointerEvent): void {
    if (!primary) {
      return;
    }

    movePointer(event);
    clearLongPress();

    if (!primary.moved) {
      onTap();
    }

    primary = null;
    mode = "idle";
  }

  function startScroll(): void {
    clearLongPress();
    primary = null;
    mode = "scroll";
    scrollRemainder = 0;
    lastScrollY = centerY() ?? 0;
  }

  function moveScroll(): void {
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

  function centerY(): number | null {
    if (pointers.size !== 2) {
      return null;
    }

    const positions = [...pointers.values()];
    const first = positions[0];
    const second = positions[1];

    if (!first || !second) {
      return null;
    }

    return (first.y + second.y) / 2;
  }

  function clearLongPress(): void {
    if (longPressTimer === null) {
      return;
    }

    clearTimeout(longPressTimer);
    longPressTimer = null;
  }

  function blockGesture(): void {
    clearLongPress();
    primary = null;
    scrollRemainder = 0;
    mode = "blocked";
  }
}

function limit(value: number, max: number): number {
  return Math.max(-max, Math.min(max, value));
}

import { requiredElement } from "./dom.js";

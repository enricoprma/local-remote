import { requiredElement } from "./dom.js";
import {
  attachGestureRecognizer,
  type GestureHandlers,
} from "./gestureRecognizer.js";

export type { GestureHandlers } from "./gestureRecognizer.js";

const POINTER_SENSITIVITY = 4;
const SCROLL_SENSITIVITY = 5;
const MAX_POINTER_MOVE = 500;
const MAX_SCROLL = 20;

export function mountGestures(
  root: HTMLElement,
  handlers: GestureHandlers,
): () => void {
  const touchArea = requiredElement(root, "#touch-area", HTMLElement);
  let pointerRemainderX = 0;
  let pointerRemainderY = 0;
  let scrollRemainder = 0;

  touchArea.addEventListener("pointerdown", () => {
    pointerRemainderX = 0;
    pointerRemainderY = 0;
    scrollRemainder = 0;
  });

  return attachGestureRecognizer(touchArea, {
    ...handlers,
    onMove(dx, dy) {
      const rawX = dx * POINTER_SENSITIVITY + pointerRemainderX;
      const rawY = dy * POINTER_SENSITIVITY + pointerRemainderY;
      const wholeX = Math.trunc(rawX);
      const wholeY = Math.trunc(rawY);
      pointerRemainderX = rawX - wholeX;
      pointerRemainderY = rawY - wholeY;

      const moveX = limit(wholeX, MAX_POINTER_MOVE);
      const moveY = limit(wholeY, MAX_POINTER_MOVE);
      if (moveX !== 0 || moveY !== 0) handlers.onMove(moveX, moveY);
    },
    onScroll(dy) {
      const rawSteps = dy * SCROLL_SENSITIVITY + scrollRemainder;
      const wholeSteps = Math.trunc(rawSteps);
      scrollRemainder = rawSteps - wholeSteps;
      const steps = limit(wholeSteps, MAX_SCROLL);
      if (steps !== 0) handlers.onScroll(steps);
    },
  });
}

function limit(value: number, max: number): number {
  return Math.max(-max, Math.min(max, value));
}

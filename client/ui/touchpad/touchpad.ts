import { PointerGestureRecognizer } from "./gestures/pointer-gesture-recognizer.js";
import { MAX_POINTER_MOVE, MAX_SCROLL } from "../../input-limits.js";
import type {
  GestureHandlers,
  GestureRecognizer,
  GestureRecognizerConstructor,
} from "./gestures/types.js";

export interface TouchpadHandlers {
  onClick(): void;
  onPointerMove(dx: number, dy: number): void;
  onScroll(steps: number): void;
  onSecondaryClick(): void;
  onDragStart(): void;
  onDrag(dx: number, dy: number): void;
  onDragEnd(): void;
  onTextInputRequested(): void;
}

export interface TouchpadOptions {
  pointerSensitivity?: number;
  scrollSensitivity?: number;
  recognizer?: GestureRecognizerConstructor;
}

export const DEFAULT_POINTER_SENSITIVITY = 4;
export const DEFAULT_SCROLL_SENSITIVITY = 15;
export { MAX_POINTER_MOVE, MAX_SCROLL };

export class Touchpad {
  readonly #recognizer: GestureRecognizer;
  #pointerSensitivity: number;
  #scrollSensitivity: number;
  #destroyed = false;

  constructor(
    element: HTMLElement,
    handlers: TouchpadHandlers,
    options: TouchpadOptions = {},
  ) {
    this.#pointerSensitivity = validateSensitivity(
      options.pointerSensitivity ?? DEFAULT_POINTER_SENSITIVITY,
    );
    this.#scrollSensitivity = validateSensitivity(
      options.scrollSensitivity ?? DEFAULT_SCROLL_SENSITIVITY,
    );

    const gestureHandlers: GestureHandlers = {
      onTap: () => handlers.onClick(),
      onOneFingerMove: (dx, dy) => {
        const moveX = scaleAndLimit(
          dx,
          this.#pointerSensitivity,
          MAX_POINTER_MOVE,
        );
        const moveY = scaleAndLimit(
          dy,
          this.#pointerSensitivity,
          MAX_POINTER_MOVE,
        );

        if (moveX !== 0 || moveY !== 0) {
          handlers.onPointerMove(moveX, moveY);
        }
      },
      onLongPress: () => handlers.onTextInputRequested(),
      onTwoFingerTap: () => handlers.onSecondaryClick(),
      onTwoFingerMove: (dy) => {
        const steps = scaleAndLimit(dy, this.#scrollSensitivity, MAX_SCROLL);

        if (steps !== 0) {
          handlers.onScroll(steps);
        }
      },
      onThreeFingerStart: () => handlers.onDragStart(),
      onThreeFingerMove: (dx, dy) => {
        const dragX = scaleAndLimit(
          dx,
          this.#pointerSensitivity,
          MAX_POINTER_MOVE,
        );
        const dragY = scaleAndLimit(
          dy,
          this.#pointerSensitivity,
          MAX_POINTER_MOVE,
        );

        if (dragX !== 0 || dragY !== 0) {
          handlers.onDrag(dragX, dragY);
        }
      },
      onThreeFingerEnd: () => handlers.onDragEnd(),
    };

    const Recognizer = options.recognizer ?? PointerGestureRecognizer;
    this.#recognizer = new Recognizer(element, gestureHandlers);
  }

  setEnabled(enabled: boolean): void {
    if (!this.#destroyed) {
      this.#recognizer.setEnabled(enabled);
    }
  }

  setPointerSensitivity(sensitivity: number): void {
    this.#pointerSensitivity = validateSensitivity(sensitivity);
  }

  setScrollSensitivity(sensitivity: number): void {
    this.#scrollSensitivity = validateSensitivity(sensitivity);
  }

  destroy(): void {
    if (this.#destroyed) {
      return;
    }

    this.#destroyed = true;
    this.#recognizer.destroy();
  }
}

function validateSensitivity(sensitivity: number): number {
  if (!Number.isFinite(sensitivity) || sensitivity < 0) {
    throw new RangeError("Sensitivity must be finite and non-negative");
  }

  return sensitivity;
}

function scaleAndLimit(
  delta: number,
  sensitivity: number,
  maximum: number,
): number {
  return limit(Math.trunc(delta * sensitivity), maximum);
}

function limit(value: number, maximum: number): number {
  return Math.max(-maximum, Math.min(maximum, value));
}

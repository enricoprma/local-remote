import { beforeEach, expect, test, vi } from "vitest";
import {
  Touchpad,
  type GestureHandlers,
  type GestureRecognizer,
  type TouchpadHandlers,
} from "../client/ui/touchpad/index";

class FakeRecognizer implements GestureRecognizer {
  static instances: FakeRecognizer[] = [];

  readonly setEnabled = vi.fn<(enabled: boolean) => void>();
  readonly destroy = vi.fn<() => void>();

  constructor(
    readonly element: HTMLElement,
    readonly handlers: GestureHandlers,
  ) {
    FakeRecognizer.instances.push(this);
  }
}

function createTouchpad(
  options: ConstructorParameters<typeof Touchpad>[2] = {},
) {
  const element = {} as HTMLElement;
  const handlers = {
    onClick: vi.fn<TouchpadHandlers["onClick"]>(),
    onPointerMove: vi.fn<TouchpadHandlers["onPointerMove"]>(),
    onScroll: vi.fn<TouchpadHandlers["onScroll"]>(),
    onSecondaryClick: vi.fn<TouchpadHandlers["onSecondaryClick"]>(),
    onDragStart: vi.fn<TouchpadHandlers["onDragStart"]>(),
    onDrag: vi.fn<TouchpadHandlers["onDrag"]>(),
    onDragEnd: vi.fn<TouchpadHandlers["onDragEnd"]>(),
    onTextInputRequested: vi.fn<TouchpadHandlers["onTextInputRequested"]>(),
  };
  const touchpad = new Touchpad(element, handlers, {
    ...options,
    recognizer: FakeRecognizer,
  });
  const recognizer = FakeRecognizer.instances.at(-1);

  if (!recognizer) {
    throw new Error("Fake recognizer was not constructed");
  }

  return { element, handlers, touchpad, recognizer };
}

beforeEach(() => {
  FakeRecognizer.instances = [];
});

test("maps every gesture to its distinct touchpad action", () => {
  const { element, handlers, recognizer } = createTouchpad();

  expect(recognizer.element).toBe(element);
  recognizer.handlers.onTap();
  recognizer.handlers.onOneFingerMove(2.25, -1.75);
  recognizer.handlers.onLongPress();
  recognizer.handlers.onTwoFingerTap();
  recognizer.handlers.onTwoFingerMove(1.25);
  recognizer.handlers.onThreeFingerStart();
  recognizer.handlers.onThreeFingerMove(2.25, -1.75);
  recognizer.handlers.onThreeFingerEnd();

  expect(handlers.onClick).toHaveBeenCalledTimes(1);
  expect(handlers.onPointerMove).toHaveBeenCalledWith(9, -7);
  expect(handlers.onTextInputRequested).toHaveBeenCalledTimes(1);
  expect(handlers.onSecondaryClick).toHaveBeenCalledTimes(1);
  expect(handlers.onScroll).toHaveBeenCalledWith(6);
  expect(handlers.onDragStart).toHaveBeenCalledTimes(1);
  expect(handlers.onDrag).toHaveBeenCalledWith(9, -7);
  expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
  expect(handlers.onPointerMove).toHaveBeenCalledTimes(1);
  expect(handlers.onDrag).toHaveBeenCalledTimes(1);
});

test("truncates each event independently without accumulating remainders", () => {
  const { handlers, recognizer } = createTouchpad();

  recognizer.handlers.onOneFingerMove(0.2, -0.2);
  recognizer.handlers.onOneFingerMove(0.2, -0.2);
  recognizer.handlers.onOneFingerMove(0.2, -0.2);
  recognizer.handlers.onThreeFingerMove(0.2, -0.2);
  recognizer.handlers.onTwoFingerMove(0.1);
  recognizer.handlers.onTwoFingerMove(0.1);

  expect(handlers.onPointerMove).not.toHaveBeenCalled();
  expect(handlers.onDrag).not.toHaveBeenCalled();
  expect(handlers.onScroll).not.toHaveBeenCalled();
});

test("clamps pointer, drag, and scroll output and suppresses zero movement", () => {
  const { handlers, recognizer } = createTouchpad();

  recognizer.handlers.onOneFingerMove(1_000, -1_000);
  recognizer.handlers.onOneFingerMove(0, 0);
  recognizer.handlers.onThreeFingerMove(-1_000, 1_000);
  recognizer.handlers.onThreeFingerMove(0, 0);
  recognizer.handlers.onTwoFingerMove(1_000);
  recognizer.handlers.onTwoFingerMove(0);

  expect(handlers.onPointerMove.mock.calls).toEqual([[500, -500]]);
  expect(handlers.onDrag.mock.calls).toEqual([[-500, 500]]);
  expect(handlers.onScroll.mock.calls).toEqual([[20]]);
});

test("initial options and sensitivity setters affect following events", () => {
  const { handlers, recognizer, touchpad } = createTouchpad({
    pointerSensitivity: 2,
    scrollSensitivity: 3,
  });

  recognizer.handlers.onOneFingerMove(1.75, -1.75);
  recognizer.handlers.onTwoFingerMove(1.75);
  touchpad.setPointerSensitivity(3);
  touchpad.setScrollSensitivity(4);
  recognizer.handlers.onOneFingerMove(1.75, -1.75);
  recognizer.handlers.onThreeFingerMove(1.75, -1.75);
  recognizer.handlers.onTwoFingerMove(1.75);

  expect(handlers.onPointerMove.mock.calls).toEqual([
    [3, -3],
    [5, -5],
  ]);
  expect(handlers.onDrag).toHaveBeenCalledWith(5, -5);
  expect(handlers.onScroll.mock.calls).toEqual([[5], [7]]);
});

test.each([-1, Number.NaN, Number.POSITIVE_INFINITY])(
  "rejects invalid initial sensitivity %s before constructing a recognizer",
  (sensitivity) => {
    expect(() => createTouchpad({ pointerSensitivity: sensitivity })).toThrow(
      RangeError,
    );
    expect(() => createTouchpad({ scrollSensitivity: sensitivity })).toThrow(
      RangeError,
    );
    expect(FakeRecognizer.instances).toHaveLength(0);
  },
);

test.each([-1, Number.NaN, Number.NEGATIVE_INFINITY])(
  "rejects invalid runtime sensitivity %s without changing it",
  (sensitivity) => {
    const { handlers, recognizer, touchpad } = createTouchpad();

    expect(() => touchpad.setPointerSensitivity(sensitivity)).toThrow(
      RangeError,
    );
    expect(() => touchpad.setScrollSensitivity(sensitivity)).toThrow(
      RangeError,
    );
    recognizer.handlers.onOneFingerMove(1, 1);
    recognizer.handlers.onTwoFingerMove(1);
    expect(handlers.onPointerMove).toHaveBeenCalledWith(4, 4);
    expect(handlers.onScroll).toHaveBeenCalledWith(5);
  },
);

test("forwards enable and destroys the recognizer exactly once", () => {
  const { recognizer, touchpad } = createTouchpad();

  touchpad.setEnabled(false);
  touchpad.setEnabled(true);
  touchpad.destroy();
  touchpad.destroy();
  touchpad.setEnabled(true);

  expect(recognizer.setEnabled.mock.calls).toEqual([[false], [true]]);
  expect(recognizer.destroy).toHaveBeenCalledTimes(1);
});

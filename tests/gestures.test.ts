import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mountGestures, type GestureHandlers } from "../client/ui/touchpad";
import { attachGestureRecognizer } from "../client/ui/gestureRecognizer";

// Exercise real event listeners and timers without adding a DOM dependency.
// Device-level capture and virtual-keyboard behavior still need a phone test.
class ElementStub extends EventTarget {
  style = { touchAction: "" };
  setPointerCapture = vi.fn();
  querySelector = vi.fn();
}

function setup(ui = false) {
  const browser = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const root = new ElementStub();
  const touchArea = new ElementStub();
  root.querySelector.mockReturnValue(touchArea);
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", document);
  vi.stubGlobal("HTMLElement", ElementStub);

  const handlers = {
    onTap: vi.fn<GestureHandlers["onTap"]>(),
    onMove: vi.fn<GestureHandlers["onMove"]>(),
    onScroll: vi.fn<GestureHandlers["onScroll"]>(),
    onLongPress: vi.fn<GestureHandlers["onLongPress"]>(),
    onLongPressCancel: vi.fn<GestureHandlers["onLongPressCancel"]>(),
    onRightClick: vi.fn<GestureHandlers["onRightClick"]>(),
    onDragStart: vi.fn<GestureHandlers["onDragStart"]>(),
    onDragEnd: vi.fn<GestureHandlers["onDragEnd"]>(),
  };
  const cancel = ui
    ? mountGestures(root as unknown as HTMLElement, handlers)
    : attachGestureRecognizer(touchArea as unknown as HTMLElement, handlers);

  function send(type: string, id = 1, x = 100, y = 100, time = Date.now(), target?: EventTarget) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      pointerId: id, clientX: x, clientY: y, button: 0, pointerType: "touch",
    });
    Object.defineProperty(event, "timeStamp", { value: time });
    (target ?? (type === "pointerdown" || type === "lostpointercapture" ? touchArea : browser))
      .dispatchEvent(event);
  }

  function tap(id = 1, x = 100) {
    send("pointerdown", id, x);
    vi.advanceTimersByTime(20);
    send("pointerup", id, x);
  }

  function drag() {
    send("pointerdown", 1);
    send("pointerdown", 2);
    expect(handlers.onDragStart).not.toHaveBeenCalled();
    send("pointerdown", 3);
    expect(handlers.onDragStart).toHaveBeenCalledTimes(1);
  }

  return { handlers, send, tap, drag, cancel, root, touchArea, browser, document };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test.each([7.9, 8, 15])("classifies movement at distance %s and never clicks after crossing", distance => {
  const { send, handlers } = setup();
  send("pointerdown");
  send("pointermove", 1, 100 + distance);
  send("pointerup", 1, 100);
  expect(handlers.onTap).toHaveBeenCalledTimes(distance < 8 ? 1 : 0);
  if (distance < 8) expect(handlers.onMove).not.toHaveBeenCalled();
  else expect(handlers.onMove).toHaveBeenNthCalledWith(1, distance, 0);
});

test("checks release-only movement and includes the final moving delta", () => {
  const { send, handlers } = setup();
  send("pointerdown");
  send("pointerup", 1, 112);
  expect(handlers.onTap).not.toHaveBeenCalled();
  expect(handlers.onMove).toHaveBeenCalledWith(12, 0);
  send("pointerdown");
  send("pointermove", 1, 110);
  send("pointerup", 1, 114);
  expect(handlers.onMove).toHaveBeenLastCalledWith(4, 0);
});

test("recognizes a hold and opens text entry only on normal release", () => {
  const { send, handlers } = setup();
  send("pointerdown");
  vi.advanceTimersByTime(450);
  expect(handlers.onLongPress).not.toHaveBeenCalled();
  send("pointerup");
  send("lostpointercapture");
  expect(handlers.onLongPress).toHaveBeenCalledTimes(1);
  expect(handlers.onLongPressCancel).not.toHaveBeenCalled();
  expect(handlers.onTap).not.toHaveBeenCalled();
});

test("a delayed hold timer cannot turn a long release into a tap", () => {
  const { send, handlers } = setup();
  send("pointerdown");
  send("pointerup", 1, 100, 100, 500);
  vi.advanceTimersByTime(500);
  expect(handlers.onLongPress).toHaveBeenCalledTimes(1);
  expect(handlers.onTap).not.toHaveBeenCalled();
});

test.each(["pointercancel", "movement", "second finger", "capture loss"])(
  "%s cancels the old hold timer before another gesture starts", ending => {
    const { send, handlers } = setup();
    send("pointerdown");
    vi.advanceTimersByTime(400);
    if (ending === "movement") send("pointermove", 1, 110);
    if (ending === "second finger") send("pointerdown", 2);
    if (ending === "capture loss") send("lostpointercapture");
    send("pointercancel");
    send("pointercancel", 2);
    send("pointerdown", 3);
    vi.advanceTimersByTime(60);
    send("pointerup", 3);
    expect(handlers.onTap).toHaveBeenCalledTimes(1);
    expect(handlers.onLongPress).not.toHaveBeenCalled();
    expect(handlers.onDragStart).not.toHaveBeenCalled();
  },
);

test("a second finger cancels long press without clicking on release", () => {
  const { send, handlers, tap } = setup();
  send("pointerdown");
  vi.advanceTimersByTime(450);
  send("pointerdown", 2);
  send("pointerup");
  send("pointerup", 2);
  expect(handlers.onLongPressCancel).toHaveBeenCalledTimes(1);
  expect(handlers.onLongPress).not.toHaveBeenCalled();
  expect(handlers.onRightClick).not.toHaveBeenCalled();
  tap();
  expect(handlers.onTap).toHaveBeenCalledTimes(1);
});

test("a previously queued hold callback cannot fire against a later contact", () => {
  const timer = vi.spyOn(globalThis, "setTimeout");
  try {
    const { send, handlers } = setup();
    send("pointerdown");
    const oldHold = timer.mock.calls[0][0];
    send("pointercancel");
    send("pointerdown", 2);
    if (typeof oldHold !== "function") throw new Error("Expected timer callback");
    oldHold();
    send("pointerup", 2);
    expect(handlers.onTap).toHaveBeenCalledTimes(1);
    expect(handlers.onLongPress).not.toHaveBeenCalled();
    expect(handlers.onDragStart).not.toHaveBeenCalled();
  } finally {
    timer.mockRestore();
  }
});

test("replacing a finger after a two-finger release blocks until every contact ends", () => {
  const { send, handlers, tap } = setup();
  send("pointerdown", 1);
  send("pointermove", 1, 108);
  send("pointerdown", 2);
  send("pointerup", 1);
  send("pointerdown", 3);
  send("pointerup", 2);
  send("pointermove", 3, 200, 200);
  send("pointerup", 3);
  expect(handlers.onMove).toHaveBeenCalledTimes(1);
  expect(handlers.onTap).not.toHaveBeenCalled();
  expect(handlers.onScroll).not.toHaveBeenCalled();
  expect(handlers.onRightClick).not.toHaveBeenCalled();
  expect(handlers.onDragStart).not.toHaveBeenCalled();
  tap();
  expect(handlers.onTap).toHaveBeenCalledTimes(1);
});

test("the third finger starts drag immediately and release sends final movement before drag end", () => {
  const { send, handlers, drag } = setup();
  const order: string[] = [];
  handlers.onDragStart.mockImplementation(() => order.push("start"));
  handlers.onMove.mockImplementation((dx, dy) => order.push(`move ${dx} ${dy}`));
  handlers.onDragEnd.mockImplementation(() => order.push("end"));
  drag();
  expect(handlers.onMove).not.toHaveBeenCalled();
  send("pointermove", 1, 109, 106);
  send("pointerup", 1, 112, 109);
  send("lostpointercapture");
  expect(order).toEqual(["start", "move 3 2", "move 1 1", "end"]);
  expect(handlers.onTap).not.toHaveBeenCalled();
  expect(handlers.onLongPress).not.toHaveBeenCalled();
});

test.each(["cancel", "fourth finger", "capture loss", "blur", "hidden", "pagehide", "request failure"])(
  "ends a drag exactly once after %s", ending => {
    const { send, handlers, drag, cancel, browser, document } = setup();
    drag();
    if (ending === "cancel") send("pointercancel");
    if (ending === "fourth finger") send("pointerdown", 4);
    if (ending === "capture loss") send("lostpointercapture");
    if (ending === "blur" || ending === "pagehide") browser.dispatchEvent(new Event(ending));
    if (ending === "hidden") {
      document.visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    }
    if (ending === "request failure") cancel();
    send("pointerup");
    send("pointerup", 2);
    send("pointerup", 3);
    send("pointerup", 4);
    send("lostpointercapture");
    vi.advanceTimersByTime(1000);
    expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
    expect(handlers.onTap).not.toHaveBeenCalled();
    expect(handlers.onRightClick).not.toHaveBeenCalled();
  },
);

test("one-finger movement after a tap remains pointer movement", () => {
  const { send, handlers, tap } = setup();
  tap();
  send("pointerdown");
  send("pointermove", 1, 108);
  vi.advanceTimersByTime(450);
  send("pointerup", 1, 108);
  expect(handlers.onDragStart).not.toHaveBeenCalled();
  expect(handlers.onTap).toHaveBeenCalledTimes(1);
});

test("tap then hold opens text entry instead of starting drag", () => {
  const { send, handlers, tap } = setup();
  tap();
  send("pointerdown");
  vi.advanceTimersByTime(450);
  send("pointerup");
  expect(handlers.onDragStart).not.toHaveBeenCalled();
  expect(handlers.onTap).toHaveBeenCalledTimes(1);
  expect(handlers.onLongPress).toHaveBeenCalledTimes(1);
});

test("two quick one-finger taps still click twice", () => {
  const { handlers, tap } = setup();
  tap();
  tap();
  expect(handlers.onTap).toHaveBeenCalledTimes(2);
  expect(handlers.onDragStart).not.toHaveBeenCalled();
});

test("three-finger movement follows the center without a jump or triple speed", () => {
  const { send, handlers } = setup();
  send("pointerdown", 1, 100, 100);
  send("pointerdown", 2, 130, 115);
  send("pointerdown", 3, 160, 130);
  expect(handlers.onMove).not.toHaveBeenCalled();
  send("pointermove", 1, 109, 106);
  send("pointermove", 2, 139, 121);
  send("pointermove", 3, 169, 136);
  expect(handlers.onMove.mock.calls).toEqual([[3, 2], [3, 2], [3, 2]]);
  expect(handlers.onScroll).not.toHaveBeenCalled();
  send("pointerup", 2, 139, 121);
  expect(handlers.onMove).toHaveBeenCalledTimes(3);
  expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
});

test.each([1, 2, 3])("release of drag finger %s ends drag and blocks the remaining contacts", id => {
  const { send, handlers, drag, tap } = setup();
  drag();
  send("pointerup", id);
  expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
  const remaining = [1, 2, 3].filter(fingerId => fingerId !== id);
  // Replacing the released finger must not start another drag mid-gesture.
  send("pointerdown", 4);
  for (const fingerId of remaining) {
    send("pointermove", fingerId, 200, 200);
    send("pointerup", fingerId, 200, 200);
  }
  send("pointerup", 4);
  expect(handlers.onMove).not.toHaveBeenCalled();
  expect(handlers.onTap).not.toHaveBeenCalled();
  expect(handlers.onRightClick).not.toHaveBeenCalled();
  expect(handlers.onScroll).not.toHaveBeenCalled();
  expect(handlers.onDragStart).toHaveBeenCalledTimes(1);
  expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
  tap();
  expect(handlers.onTap).toHaveBeenCalledTimes(1);
});

test.each([1, 2, 3])("cancellation of drag finger %s ends drag without final movement", id => {
  const { send, handlers, drag } = setup();
  drag();
  send("pointercancel", id, 200, 200);
  expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
  for (const fingerId of [1, 2, 3]) send("pointerup", fingerId);
  expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
  expect(handlers.onMove).not.toHaveBeenCalled();
  expect(handlers.onRightClick).not.toHaveBeenCalled();
});

test.each(["movement", "hold", "scroll"])("third finger can start dragging after %s", prior => {
  const { send, handlers } = setup();
  send("pointerdown", 1);
  if (prior === "movement") send("pointermove", 1, 109, 106);
  if (prior === "hold") vi.advanceTimersByTime(450);
  send("pointerdown", 2, 130, 100);
  if (prior === "scroll") send("pointermove", 2, 130, 109);
  handlers.onMove.mockClear();
  handlers.onScroll.mockClear();
  send("pointerdown", 3, 160, 100);
  expect(handlers.onDragStart).toHaveBeenCalledTimes(1);
  expect(handlers.onMove).not.toHaveBeenCalled();
  expect(handlers.onScroll).not.toHaveBeenCalled();
  send("pointermove", 3, 169, 106);
  expect(handlers.onMove).toHaveBeenCalledWith(3, 2);
  send("pointerup", 3, 169, 106);
  send("pointerup", 2);
  send("pointerup", 1);
  expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
  expect(handlers.onLongPress).not.toHaveBeenCalled();
  expect(handlers.onRightClick).not.toHaveBeenCalled();
});

test.each([1, 2])("right-click waits for both releases, starting with finger %s", first => {
  const { send, handlers } = setup();
  send("pointerdown", 1);
  send("pointerdown", 2);
  send("pointerup", first);
  send("lostpointercapture", first);
  expect(handlers.onRightClick).not.toHaveBeenCalled();
  send("pointerup", first === 1 ? 2 : 1);
  expect(handlers.onRightClick).toHaveBeenCalledTimes(1);
  expect(handlers.onTap).not.toHaveBeenCalled();
  expect(handlers.onScroll).not.toHaveBeenCalled();
});

test.each(["cancel", "late release", "movement", "release movement", "third finger"])(
  "%s after the first release suppresses right-click", ending => {
    const { send, handlers, tap } = setup();
    send("pointerdown", 1);
    send("pointerdown", 2);
    send("pointerup", 1);
    if (ending === "late release") vi.advanceTimersByTime(351);
    if (ending === "movement") send("pointermove", 2, 108);
    if (ending === "third finger") send("pointerdown", 3);
    send(ending === "cancel" ? "pointercancel" : "pointerup", 2,
      ending === "release movement" ? 108 : 100);
    send("pointerup", 3);
    expect(handlers.onRightClick).not.toHaveBeenCalled();
    expect(handlers.onScroll).not.toHaveBeenCalled();
    tap();
    expect(handlers.onTap).toHaveBeenCalledTimes(1);
  },
);

test("two-finger tap timing starts with the first finger", () => {
  const { send, handlers } = setup();
  send("pointerdown", 1);
  vi.advanceTimersByTime(340);
  send("pointerdown", 2);
  vi.advanceTimersByTime(20);
  send("pointerup", 1);
  send("pointerup", 2);
  expect(handlers.onRightClick).not.toHaveBeenCalled();
});

test("scroll includes threshold and release deltas, then ignores the remaining finger", () => {
  const { send, handlers } = setup();
  send("pointerdown", 1);
  send("pointerdown", 2);
  send("pointermove", 1, 100, 104);
  expect(handlers.onScroll).not.toHaveBeenCalled();
  send("pointermove", 1, 100, 108);
  send("pointermove", 2, 100, 108);
  send("pointerup", 1, 100, 112);
  send("pointermove", 2, 100, 120);
  send("pointerup", 2, 100, 120);
  expect(handlers.onScroll.mock.calls).toEqual([[4], [4], [2]]);
  expect(handlers.onRightClick).not.toHaveBeenCalled();
  expect(handlers.onMove).not.toHaveBeenCalled();
});

test.each(["horizontal", "third finger", "cancel"])("%s suppresses two-finger tap", change => {
  const { send, handlers } = setup();
  send("pointerdown", 1);
  send("pointerdown", 2);
  if (change === "horizontal") send("pointermove", 1, 108);
  if (change === "third finger") send("pointerdown", 3);
  send(change === "cancel" ? "pointercancel" : "pointerup", 1);
  send("pointerup", 2);
  send("pointerup", 3);
  expect(handlers.onRightClick).not.toHaveBeenCalled();
  expect(handlers.onScroll).not.toHaveBeenCalled();
});

test("duplicate and unrelated events cannot create extra fingers or end a drag", () => {
  const { send, handlers, drag } = setup();
  drag();
  send("pointerdown", 1);
  send("pointercancel", 99);
  send("pointerup", 99);
  expect(handlers.onDragEnd).not.toHaveBeenCalled();
  send("pointerup", 1);
  expect(handlers.onDragEnd).toHaveBeenCalledTimes(1);
});

test("a failed capture cannot arm a hold", () => {
  const { send, handlers, touchArea } = setup();
  touchArea.setPointerCapture.mockImplementation(() => { throw new Error("Inactive pointer"); });
  send("pointerdown");
  vi.advanceTimersByTime(450);
  send("pointerup");
  expect(handlers.onTap).not.toHaveBeenCalled();
  expect(handlers.onLongPress).not.toHaveBeenCalled();
});

test("the UI scopes gestures to the touch area and keeps bounded integer movement", () => {
  const { send, handlers, root } = setup(true);
  send("pointerdown", 1, 100, 100, 0, root);
  send("pointerup", 1);
  expect(handlers.onTap).not.toHaveBeenCalled();
  send("pointerdown");
  send("pointermove", 1, 108.125);
  send("pointermove", 1, 108.25);
  send("pointerup", 1, 1000);
  expect(handlers.onMove.mock.calls).toEqual([[32, 0], [1, 0], [500, 0]]);
});

test("the UI preserves scroll sign, limits, and substep remainders", () => {
  const { send, handlers } = setup(true);
  send("pointerdown", 1);
  send("pointerdown", 2);
  send("pointermove", 1, 100, 108);
  send("pointermove", 1, 100, 108.125);
  send("pointermove", 1, 100, 108.5);
  send("pointermove", 1, 100, -100);
  expect(handlers.onScroll.mock.calls).toEqual([[20], [1], [-20]]);
});

const buttons = document.querySelectorAll("button[data-action]");
const feedback = document.querySelector(".feedback");
const touchArea = document.querySelector(".touch-area");
const textEntry = document.querySelector(".text-entry");
const textInput = textEntry.querySelector("input");

const TAP_MAX_DISTANCE = 12;
const TAP_MAX_DURATION = 500;
const LONG_PRESS_DURATION = 500;
const MAX_POINTER_DELTA = 500;
const SCROLL_PIXELS_PER_STEP = 0.5;
const MAX_SCROLL_DELTA = 20;

const activePointers = new Map();
let gesture = null;
let waitForAllPointersToEnd = false;
let textCompositionActive = false;
let textSubmissionPending = false;

for (const button of buttons) {
  button.addEventListener("click", () => {
    const action = button.dataset.action;

    if (action) {
      void sendAction(action, button.textContent.trim());
    }
  });
}

textEntry.addEventListener("submit", (event) => {
  event.preventDefault();

  if (textCompositionActive) {
    return;
  }

  void submitTextInput();
});

textInput.addEventListener("keydown", (event) => {
  if (
    event.key !== "Enter" ||
    event.isComposing ||
    textCompositionActive
  ) {
    return;
  }

  event.preventDefault();
  void submitTextInput();
});

textInput.addEventListener("compositionstart", () => {
  textCompositionActive = true;
});

textInput.addEventListener("compositionend", () => {
  textCompositionActive = false;
});

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
    return;
  }

  if (activePointers.size === 1 && gesture === null) {
    gesture = createPointerGesture(event);
    return;
  }

  if (activePointers.size === 2 && gesture?.type === "pointer") {
    if (gesture.longPressRecognized) {
      discardPendingMovement(gesture);
      textInput.blur();
      gesture = null;
      waitForAllPointersToEnd = true;
      return;
    }

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
    openTextInput();
    showFeedback("Keyboard", false);
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
    openTextInput();
    showFeedback("Keyboard", false);
    return;
  }

  if (
    !activeGesture.movedBeyondTapDistance &&
    duration <= TAP_MAX_DURATION
  ) {
    void sendAction("click", "Click");
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
  openTextInput();
  showFeedback("Keyboard", false);
}

function openTextInput() {
  textInput.focus({ preventScroll: true });
  textInput.setSelectionRange(textInput.value.length, textInput.value.length);
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
    void sendScrollMovement(steps);
  }

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

  activeGesture.pendingDx += dx * 4;
  activeGesture.pendingDy += dy * 4;

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
    void sendPointerMovement(dx, dy);
  }

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

async function sendAction(action, label) {
  showFeedback(label, false);
  return sendRequest("/api/action", { action }, "Action");
}

async function submitTextInput() {
  if (textSubmissionPending) {
    return;
  }

  textSubmissionPending = true;
  const text = textInput.value;

  if (text.length > 0) {
    const textSent = await sendText(text);

    if (!textSent) {
      textSubmissionPending = false;
      openTextInput();
      return;
    }

    textInput.value = "";
  }

  const enterSent = await sendAction("enter", "Enter");
  textSubmissionPending = false;

  if (enterSent) {
    textInput.blur();
  } else {
    openTextInput();
  }
}

async function sendText(text) {
  showFeedback("Text", false);
  return sendRequest("/api/text", { text }, "Text");
}

async function sendPointerMovement(dx, dy) {
  await sendRequest("/api/pointer", { dx, dy }, "Pointer");
}

async function sendScrollMovement(dy) {
  await sendRequest("/api/scroll", { dy }, "Scroll");
}

async function sendRequest(path, body, requestName) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return true;
  } catch (error) {
    console.error(`${requestName} request failed:`, error);
    showFeedback("Connection failed", true);
    return false;
  }
}

function showFeedback(message, isError) {
  const feedbackId = String(performance.now());

  feedback.textContent = message;
  feedback.dataset.feedbackId = feedbackId;
  feedback.classList.toggle("feedback--error", isError);

  window.setTimeout(() => {
    if (feedback.dataset.feedbackId === feedbackId) {
      feedback.textContent = "";
    }
  }, 900);
}

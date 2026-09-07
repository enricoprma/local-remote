import * as remote from "./api.js";
import { setupGestures } from "./gestures.js";

const buttons = document.querySelectorAll("button[data-action]");
const feedback = document.querySelector(".feedback");
const touchArea = document.querySelector(".touch-area");
const textEntry = document.querySelector(".text-entry");
const textInput = textEntry.querySelector("input");

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

setupGestures(touchArea, {
  onTap: () => {
    void sendAction("click", "Click");
  },
  onMove: (dx, dy) => {
    void sendPointerMovement(dx, dy);
  },
  onScroll: (dy) => {
    void sendScrollMovement(dy);
  },
  onLongPress: () => {
    openTextInput();
    showFeedback("Keyboard", false);
  },
  onLongPressCancel: () => {
    textInput.blur();
  },
});

function openTextInput() {
  textInput.focus({ preventScroll: true });
  textInput.setSelectionRange(textInput.value.length, textInput.value.length);
}

async function sendAction(action, label) {
  showFeedback(label, false);
  return runRemote(remote.action(action), "Action");
}

async function submitTextInput() {
  if (textSubmissionPending) {
    return;
  }

  textSubmissionPending = true;
  const text = textInput.value;

  // Text must reach the remote machine before Enter is sent; clear only after success.
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
  return runRemote(remote.typeText(text), "Text");
}

function sendPointerMovement(dx, dy) {
  return runRemote(remote.movePointer(dx, dy), "Pointer");
}

function sendScrollMovement(dy) {
  return runRemote(remote.scroll(dy), "Scroll");
}

async function runRemote(request, requestName) {
  // Gesture callbacks are fire-and-forget, so every rejected request is handled here.
  try {
    await request;
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

  // An older timeout must not clear feedback that belongs to a newer request.
  window.setTimeout(() => {
    if (feedback.dataset.feedbackId === feedbackId) {
      feedback.textContent = "";
    }
  }, 900);
}

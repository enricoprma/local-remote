import * as remote from "./api.js";
import { setupGestures } from "./gestures.js";
import { createPairingForm } from "./pairing.js";

const buttons =
  document.querySelectorAll("button[data-action]");

const feedback =
  document.querySelector(".feedback");

const touchArea =
  document.querySelector(".touch-area");

const textEntry =
  document.querySelector(".text-entry");

const textInput =
  textEntry.querySelector("input");

const pairingForm =
  createPairingForm({
    onSubmit: pairWithCode,
  });

let textCompositionActive = false;
let textSubmissionPending = false;

await initializePairing();

for (const button of buttons) {
  button.addEventListener("click", () => {
    const action = button.dataset.action;

    if (action) {
      void sendAction(
        action,
        button.textContent.trim(),
      );
    }
  });
}

textEntry.addEventListener(
  "submit",
  (event) => {
    event.preventDefault();

    if (textCompositionActive) {
      return;
    }

    void submitTextInput();
  },
);

textInput.addEventListener(
  "keydown",
  (event) => {
    if (
      event.key !== "Enter" ||
      event.isComposing ||
      textCompositionActive
    ) {
      return;
    }

    event.preventDefault();
    void submitTextInput();
  },
);

textInput.addEventListener(
  "compositionstart",
  () => {
    textCompositionActive = true;
  },
);

textInput.addEventListener(
  "compositionend",
  () => {
    textCompositionActive = false;
  },
);

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

async function initializePairing() {
  const params = new URLSearchParams(
    window.location.hash.slice(1),
  );

  const secret = params.get("pair");

  if (secret) {
    await pairWithCredential(secret);
    return;
  }

  try {
    const authenticated =
      await remote.hasSession();

    if (!authenticated) {
      pairingForm.show();
    }
  } catch (error) {
    console.error(
      "Session check failed:",
      error,
    );

    showFeedback(
      "Connection failed",
      true,
    );
  }
}

async function pairWithCode(code) {
  const normalizedCode =
    code.replace(/\s/g, "");

  if (!/^\d{6}$/.test(normalizedCode)) {
    showFeedback(
      "Enter a 6-digit code",
      true,
    );

    return false;
  }

  return pairWithCredential(
    normalizedCode,
  );
}

async function pairWithCredential(
  credential,
) {
  try {
    await remote.pair(credential);

    history.replaceState(
      null,
      "",
      window.location.pathname +
        window.location.search,
    );

    pairingForm.hide();

    showFeedback(
      "Connected",
      false,
    );

    return true;
  } catch (error) {
    console.error(
      "Pairing failed:",
      error,
    );

    pairingForm.show();

    showFeedback(
      "Invalid or expired code",
      true,
    );

    return false;
  }
}

function openTextInput() {
  textInput.focus({
    preventScroll: true,
  });

  textInput.setSelectionRange(
    textInput.value.length,
    textInput.value.length,
  );
}

async function sendAction(
  action,
  label,
) {
  showFeedback(label, false);

  return runRemote(
    remote.action(action),
    "Action",
  );
}

async function submitTextInput() {
  if (
    textSubmissionPending ||
    textCompositionActive
  ) {
    return;
  }

  textSubmissionPending = true;
  textInput.readOnly = true;

  try {
    const text = textInput.value;

    if (text.length > 0) {
      const textSent =
        await sendText(text);

      if (!textSent) {
        return;
      }

      textInput.value = "";
    }

    const enterSent =
      await sendAction(
        "enter",
        "Enter",
      );

    if (enterSent) {
      textInput.blur();
    }
  } finally {
    textInput.readOnly = false;
    textSubmissionPending = false;
  }
}

async function sendText(text) {
  showFeedback(
    "Text",
    false,
  );

  return runRemote(
    remote.typeText(text),
    "Text",
  );
}

function sendPointerMovement(
  dx,
  dy,
) {
  return runRemote(
    remote.movePointer(dx, dy),
    "Pointer",
  );
}

function sendScrollMovement(dy) {
  return runRemote(
    remote.scroll(dy),
    "Scroll",
  );
}

async function runRemote(
  request,
  requestName,
) {
  // Gesture callbacks are fire-and-forget,
  // so every rejected request is handled here.
  try {
    await request;

    return true;
  } catch (error) {
    console.error(
      `${requestName} request failed:`,
      error,
    );

    if (error.status === 401) {
      pairingForm.show();

      showFeedback(
        "Pairing required",
        true,
      );

      return false;
    }

    showFeedback(
      "Connection failed",
      true,
    );

    return false;
  }
}

function showFeedback(
  message,
  isError,
) {
  const feedbackId =
    String(performance.now());

  feedback.textContent =
    message;

  feedback.dataset.feedbackId =
    feedbackId;

  feedback.classList.toggle(
    "feedback--error",
    isError,
  );

  // An older timeout must not clear feedback
  // that belongs to a newer request.
  window.setTimeout(() => {
    if (
      feedback.dataset.feedbackId ===
      feedbackId
    ) {
      feedback.textContent = "";
    }
  }, 900);
}
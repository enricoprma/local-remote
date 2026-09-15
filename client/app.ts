import * as pairing from "./services/pairing.js";
import * as remote from "./services/remote.js";
import { HttpError } from "./services/http.js";
import { mountControls } from "./ui/controls.js";
import { requiredElement } from "./ui/dom.js";
import { mountFeedback } from "./ui/feedback.js";
import { mountPairingForm } from "./ui/pairing-form.js";
import { mountTextEntry } from "./ui/text-entry.js";
import { Touchpad } from "./ui/touchpad/index.js";

const root = requiredElement(document, "[data-app]", HTMLElement);
const feedback = mountFeedback(root);
const pairingForm = mountPairingForm(root, {
  onSubmit: handlePairing,
});

await initializePairing();

const textEntry = mountTextEntry(root, {
  onText: (text) => runRemote(remote.typeText(text)),
  onEnter: () => runRemote(remote.action("enter")),
});

mountControls(root, (action) => runRemote(remote.action(action)));

const touchArea = requiredElement(root, "#touch-area", HTMLElement);

new Touchpad(touchArea, {
  onClick: () => {
    void runRemote(remote.action("click"));
  },

  onPointerMove: (dx, dy) => {
    void runRemote(remote.movePointer(dx, dy));
  },

  onScroll: (steps) => {
    void runRemote(remote.scroll(steps));
  },

  onSecondaryClick: () => {
    void runRemote(remote.action("right-click"));
  },

  onDragStart: () => {
    void runRemote(remote.action("start-drag"));
  },

  onDrag: (dx, dy) => {
    void runRemote(remote.movePointer(dx, dy));
  },

  onDragEnd: () => {
    void runRemote(remote.action("end-drag"));
  },

  onTextInputRequested: textEntry.open,
});

async function initializePairing(): Promise<void> {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const qrCredential = params.get("pair");

  if (qrCredential) {
    await handlePairing(qrCredential);
    return;
  }

  try {
    const authenticated = await pairing.hasSession();

    if (!authenticated) {
      pairingForm.show();
    }
  } catch (error: unknown) {
    console.error("Session check failed:", error);
    feedback.show("Connection failed", true);
  }
}

async function handlePairing(credential: string): Promise<boolean> {
  try {
    await pairing.pairWithCredential(credential);

    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );

    feedback.show("Connected", false);
    return true;
  } catch (error: unknown) {
    console.error("Pairing failed:", error);
    pairingForm.show();
    feedback.show("Invalid or expired code", true);
    return false;
  }
}

async function runRemote(request: Promise<void>): Promise<boolean> {
  try {
    await request;
    return true;
  } catch (error: unknown) {
    if (error instanceof HttpError && error.status === 401) {
      pairingForm.show();
      feedback.show("Pairing required", true);
      return false;
    }

    feedback.show("Connection failed", true);
    return false;
  }
}

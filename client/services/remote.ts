import { endpoints } from "./endpoints.js";
import { post } from "./http.js";

let pending: Promise<void> = Promise.resolve();
let generation = 0;
let queuedMovement: {
  kind: "pointer" | "scroll";
  delta: { dx: number; dy: number };
  request: Promise<void>;
} | null = null;

// Every input command shares one queue. A failed command discards commands
// already waiting behind it; releases must still run. Never retry clicks/text.
function send(command: () => Promise<void>, release = false): Promise<void> {
  // Each new command closes the preceding movement batch. Never combine
  // movement across a click, press, release, text, or change to scrolling.
  queuedMovement = null;
  const queuedGeneration = generation;
  const request = pending.then(async () => {
    // Once transmission starts, later movement needs a new batch.
    if (queuedMovement?.request === request) queuedMovement = null;
    if (!release && queuedGeneration !== generation) {
      throw new Error("Remote command cancelled after a previous failure");
    }

    try {
      await command();
    } catch (error) {
      generation++;
      throw error;
    }
  });

  pending = request.catch(() => {});
  return request;
}

function sendMovement(kind: "pointer" | "scroll", dx: number, dy: number): Promise<void> {
  if (queuedMovement?.kind === kind) {
    queuedMovement.delta.dx += dx;
    queuedMovement.delta.dy += dy;
    return queuedMovement.request;
  }

  const delta = { dx, dy };
  const request = send(() => {
    // Clamp once at dispatch to the existing API limits. Excess movement
    // is dropped instead of becoming more delayed requests after release.
    const moveX = limit(delta.dx, 500);
    const moveY = limit(delta.dy, kind === "pointer" ? 500 : 20);
    if (moveX === 0 && moveY === 0) return Promise.resolve();
    return kind === "pointer"
      ? post(endpoints.pointer, { dx: moveX, dy: moveY })
      : post(endpoints.scroll, { dy: moveY });
  });
  queuedMovement = { kind, delta, request };
  return request;
}

function limit(value: number, max: number): number {
  return Math.max(-max, Math.min(max, value));
}

export function action(action: string): Promise<void> {
  // Ending a drag must survive earlier request failures and page exit.
  const release = action === "end-drag";
  return send(() => post(endpoints.action, { action }, { keepalive: release }), release);
}

export function movePointer(
  dx: number,
  dy: number,
): Promise<void> {
  return sendMovement("pointer", dx, dy);
}

export function scroll(dy: number): Promise<void> {
  return sendMovement("scroll", 0, dy);
}

export function typeText(text: string): Promise<void> {
  return send(() => post(endpoints.text, { text }));
}

import robot from "@hurdlegroup/robotjs";

import type { RemoteAction } from "./actions";

// These native names stay internal; the HTTP API exposes only RemoteAction values.
const robotKeys = {
  enter: "enter",
  back: "escape",
  "volume-up": "audio_vol_up",
  "volume-down": "audio_vol_down",
  "left": "left",
  "right": "right",
} satisfies Record<Exclude<RemoteAction, "click">, string>;

export function executeAction(action: RemoteAction): void {
  if (action === "click") {
    robot.mouseClick("left");
    return;
  }

  robot.keyTap(robotKeys[action]);
}

export function movePointer(dx: number, dy: number): void {
  const position = robot.getMousePos();
  robot.moveMouse(position.x + dx, position.y + dy);
}

export function scroll(dy: number): void {
  robot.scrollMouse(0, dy);
}

export function typeText(text: string): void {
  robot.typeString(text);
}

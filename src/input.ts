import robot from "@hurdlegroup/robotjs";

import { getInputKey, type RemoteAction } from "./actions";

export async function executeAction(action: RemoteAction): Promise<void> {
  if (action === "click") {
    robot.mouseClick("left");
    return;
  }

  robot.keyTap(getInputKey(action));
}

export async function movePointer(dx: number, dy: number): Promise<void> {
  const position = robot.getMousePos();
  robot.moveMouse(position.x + dx, position.y + dy);
}

export async function scroll(dy: number): Promise<void> {
  robot.scrollMouse(0, dy);
}

export async function typeText(text: string): Promise<void> {
  robot.typeString(text);
}

import { endpoints } from "./endpoints.js";
import { post } from "./http.js";

export function action(action: string): Promise<void> {
  return post(endpoints.action, { action });
}

export function movePointer(
  dx: number,
  dy: number,
): Promise<void> {
  return post(endpoints.pointer, { dx, dy });
}

export function scroll(dy: number): Promise<void> {
  return post(endpoints.scroll, { dy });
}

export function typeText(text: string): Promise<void> {
  return post(endpoints.text, { text });
}

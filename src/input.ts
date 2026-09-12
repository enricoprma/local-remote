import type { RemoteAction } from "./actions";

export interface Input {
  executeAction(action: RemoteAction): void;
  movePointer(dx: number, dy: number): void;
  scroll(dy: number): void;
  typeText(text: string): void;
}

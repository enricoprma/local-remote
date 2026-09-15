export interface GestureHandlers {
  onTap(): void;
  onOneFingerMove(dx: number, dy: number): void;
  onLongPress(): void;
  onTwoFingerTap(): void;
  onTwoFingerMove(dy: number): void;
  onThreeFingerStart(): void;
  onThreeFingerMove(dx: number, dy: number): void;
  onThreeFingerEnd(): void;
}

export interface GestureRecognizer {
  setEnabled(enabled: boolean): void;
  destroy(): void;
}

export interface GestureRecognizerConstructor {
  new (element: HTMLElement, handlers: GestureHandlers): GestureRecognizer;
}

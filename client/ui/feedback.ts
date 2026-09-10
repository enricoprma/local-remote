export interface Feedback {
  show: (message: string, isError: boolean) => void;
}

export function mountFeedback(root: HTMLElement): Feedback {
  const element = requiredElement(root, "#feedback", HTMLElement);
  let clearTimeoutId: number | null = null;

  function show(message: string, isError: boolean): void {
    if (clearTimeoutId !== null) {
      window.clearTimeout(clearTimeoutId);
    }

    element.textContent = message;
    element.classList.toggle("feedback--error", isError);

    clearTimeoutId = window.setTimeout(() => {
      element.textContent = "";
      clearTimeoutId = null;
    }, 900);
  }

  return { show };
}

import { requiredElement } from "./dom.js";

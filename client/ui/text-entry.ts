interface TextEntryOptions {
  onText: (text: string) => Promise<boolean>;
  onEnter: () => Promise<boolean>;
}

export interface TextEntry {
  open: () => void;
  close: () => void;
}

export function mountTextEntry(
  root: HTMLElement,
  { onText, onEnter }: TextEntryOptions,
): TextEntry {
  const form = requiredElement(root, "#text-entry", HTMLFormElement);
  const input = requiredElement(root, "#text-input", HTMLInputElement);
  let composing = false;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });

  // Keep the fallback for browsers where the virtual keyboard does not
  // reliably submit the form. Physical-device verification can remove it.
  input.addEventListener("keydown", (event) => {
    if (
      event.key !== "Enter" ||
      event.isComposing ||
      composing ||
      input.readOnly
    ) {
      return;
    }

    event.preventDefault();
    void submit();
  });

  input.addEventListener("compositionstart", () => {
    composing = true;
  });

  input.addEventListener("compositionend", () => {
    composing = false;
  });

  function open(): void {
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function close(): void {
    input.blur();
  }

  async function submit(): Promise<void> {
    if (composing || input.readOnly) {
      return;
    }

    input.readOnly = true;

    try {
      const text = input.value;

      if (text.length > 0) {
        const textSent = await onText(text);

        if (!textSent) {
          return;
        }

        input.value = "";
      }

      const enterSent = await onEnter();

      if (enterSent) {
        input.blur();
      }
    } finally {
      input.readOnly = false;
    }
  }

  return { open, close };
}
import { requiredElement } from "./dom.js";

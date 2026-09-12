interface PairingFormOptions {
  onSubmit: (code: string) => Promise<boolean>;
}

export interface PairingForm {
  show: () => void;
  paired: () => void;
}

export function mountPairingForm(
  root: HTMLElement,
  { onSubmit }: PairingFormOptions,
): PairingForm {
  const form = requiredElement(root, "#pairing-form", HTMLFormElement);
  const input = requiredElement(root, "#pairing-code", HTMLInputElement);

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });

  function show(): void {
    form.hidden = false;
    input.focus();
  }

  function paired(): void {
    form.hidden = true;
    input.value = "";
  }

  async function submit(): Promise<void> {
    const success = await onSubmit(input.value);

    if (success) {
      paired();
    }
  }

  return { show, paired };
}
import { requiredElement } from "./dom.js";

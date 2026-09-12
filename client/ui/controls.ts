import { requiredElement } from "./dom.js";

export function mountControls(
  root: HTMLElement,
  onAction: (action: string) => Promise<boolean>,
): void {
  const controls = requiredElement(root, ".controls", HTMLElement);

  controls.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const button = event.target.closest<HTMLButtonElement>(
      "button[data-action]",
    );

    const action = button?.dataset.action;

    if (!button || !action) {
      return;
    }

    showButtonPress(button);
    void onAction(action);
  });
}

function showButtonPress(button: HTMLButtonElement): void {
  button.classList.add("button--pressed");

  window.setTimeout(() => {
    button.classList.remove("button--pressed");
  }, 160);
}

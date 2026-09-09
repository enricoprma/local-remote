export function createPairingForm({
  onSubmit,
}) {
  const form =
    document.querySelector(".pairing-form");

  const input =
    form.querySelector(".pairing-code");

  form.addEventListener(
    "submit",
    async (event) => {
      event.preventDefault();

      const code =
        input.value.replace(/\s/g, "");

      const success =
        await onSubmit(code);

      if (success) {
        hide();
        input.value = "";
      }
    },
  );

  function show() {
    form.hidden = false;
    input.focus();
  }

  function hide() {
    form.hidden = true;
  }

  return {
    show,
    hide,
  };
}
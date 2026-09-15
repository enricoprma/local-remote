import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mountTextEntry } from "../client/ui/text-entry";

class FakeFormElement extends EventTarget {}

class FakeInputElement extends EventTarget {
  value = "";
  disabled = true;
  readOnly = false;
  readonly focus = vi.fn<(options?: FocusOptions) => void>();
  readonly blur = vi.fn<() => void>();
  readonly setSelectionRange =
    vi.fn<(start: number | null, end: number | null) => void>();
}

function createTextEntry(
  onText = vi.fn<(text: string) => Promise<boolean>>().mockResolvedValue(true),
  onEnter = vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
) {
  const form = new FakeFormElement();
  const input = new FakeInputElement();
  const root = {
    querySelector(selector: string): Element | null {
      if (selector === "#text-entry") {
        return form as unknown as Element;
      }

      if (selector === "#text-input") {
        return input as unknown as Element;
      }

      return null;
    },
  } as unknown as HTMLElement;

  const textEntry = mountTextEntry(root, { onText, onEnter });

  return { form, input, onText, onEnter, textEntry };
}

function dispatchSubmit(form: FakeFormElement): Event {
  const event = new Event("submit", { cancelable: true });
  form.dispatchEvent(event);
  return event;
}

function dispatchBeforeInput(
  input: FakeInputElement,
  inputType: string,
): Event {
  const event = new Event("beforeinput", { cancelable: true });
  Object.defineProperty(event, "inputType", { value: inputType });
  input.dispatchEvent(event);
  return event;
}

async function settleSubmission(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.stubGlobal("HTMLFormElement", FakeFormElement);
  vi.stubGlobal("HTMLInputElement", FakeInputElement);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

test("enables and focuses the input only while text entry is open", () => {
  const { input, textEntry } = createTextEntry();

  textEntry.open();

  expect(input.disabled).toBe(false);
  expect(input.focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(input.setSelectionRange).toHaveBeenCalledWith(0, 0);

  textEntry.close();

  expect(input.disabled).toBe(true);
  expect(input.blur).toHaveBeenCalledTimes(1);
});

test("clears and disables the input after text and enter were sent", async () => {
  const { form, input, onText, onEnter, textEntry } = createTextEntry();
  textEntry.open();
  input.value = "Hallo";

  const event = dispatchSubmit(form);
  expect(event.defaultPrevented).toBe(true);
  expect(input.readOnly).toBe(true);

  await settleSubmission();

  expect(onText).toHaveBeenCalledWith("Hallo");
  expect(onEnter).toHaveBeenCalledTimes(1);
  expect(input.value).toBe("");
  expect(input.disabled).toBe(true);
  expect(input.blur).toHaveBeenCalledTimes(1);
  expect(input.readOnly).toBe(false);
});

test("keeps the input open and preserves text when sending text fails", async () => {
  const onText = vi
    .fn<(text: string) => Promise<boolean>>()
    .mockResolvedValue(false);
  const { form, input, onEnter, textEntry } = createTextEntry(onText);
  textEntry.open();
  input.value = "Hallo";

  dispatchSubmit(form);
  await settleSubmission();

  expect(input.value).toBe("Hallo");
  expect(input.disabled).toBe(false);
  expect(input.blur).not.toHaveBeenCalled();
  expect(input.readOnly).toBe(false);
  expect(onEnter).not.toHaveBeenCalled();
});

test("keeps the input open when sending enter fails", async () => {
  const onEnter = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
  const { form, input, textEntry } = createTextEntry(undefined, onEnter);
  textEntry.open();
  input.value = "Hallo";

  dispatchSubmit(form);
  await settleSubmission();

  expect(input.value).toBe("");
  expect(input.disabled).toBe(false);
  expect(input.blur).not.toHaveBeenCalled();
  expect(input.readOnly).toBe(false);
});

test.each(["historyUndo", "historyRedo"])(
  "prevents the %s input operation",
  (inputType) => {
    const { input } = createTextEntry();

    const event = dispatchBeforeInput(input, inputType);

    expect(event.defaultPrevented).toBe(true);
  },
);

test("allows regular text input operations", () => {
  const { input } = createTextEntry();

  const event = dispatchBeforeInput(input, "insertText");

  expect(event.defaultPrevented).toBe(false);
});

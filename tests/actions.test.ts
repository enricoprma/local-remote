import { expect, test } from "vitest";
import { isRemoteAction } from "../src/actions";

test.each([
  "click",
  "right-click",
  "start-drag",
  "end-drag",
  "enter",
  "back",
  "volume-up",
  "volume-down",
  "left",
  "right",
])("accepts the allowed action %s", (action) => {
  expect(isRemoteAction(action)).toBe(true);
});

test.each(["unknown", "", "Click", " click "])(
  "rejects the invalid action %j",
  (action) => {
    expect(isRemoteAction(action)).toBe(false);
  },
);

test.each(["toString", "constructor", "__proto__"])(
  "rejects the inherited property name %s",
  (action) => {
    expect(isRemoteAction(action)).toBe(false);
  },
);

test.each([
  { value: null },
  { value: undefined },
  { value: 123 },
  { value: true },
  { value: {} },
  { value: ["click"] },
])("rejects the non-string value $value", ({ value }) => {
  expect(isRemoteAction(value)).toBe(false);
});

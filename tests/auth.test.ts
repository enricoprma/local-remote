import { expect, test, vi, afterEach, beforeEach } from "vitest";
import { createAuth } from "../src/auth";

// Freeze time so expiration tests run without waiting.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

// Pairing: credentials, window lifetime, and pairing limit.
test("pairing creates valid sessions just before the pairing window expires", () => {
  const auth = createAuth();

  const { secret, code } = auth.openPairingWindow();

  vi.setSystemTime(Date.now() + 2 * 60 * 1000 - 1);

  const secretSession = auth.pair(secret);
  const codeSession = auth.pair(code);

  if (secretSession === null || codeSession === null) {
    throw new Error("Pairing failed");
  }

  expect(auth.isSessionValid(secretSession)).toBe(true);

  expect(auth.isSessionValid(codeSession)).toBe(true);
});

test("pairing window expires after 2 minutes", () => {
  const auth = createAuth();
  const { secret } = auth.openPairingWindow();

  vi.setSystemTime(Date.now() + 2 * 60 * 1000);

  const session = auth.pair(secret);
  expect(session).toBeNull();
});

test("pairing fails with wrong credentials", () => {
  const auth = createAuth();

  auth.openPairingWindow();

  const session = auth.pair("1");

  expect(session).toBeNull();
});

test("pairing fails after window closes", () => {
  const auth = createAuth();

  const { secret, code } = auth.openPairingWindow();

  auth.closePairingWindow();

  const secretSession = auth.pair(secret);
  const codeSession = auth.pair(code);

  expect(secretSession).toBeNull();
  expect(codeSession).toBeNull();
});

test("pairing fails after 10 successful pairings", () => {
  const auth = createAuth();

  const { secret } = auth.openPairingWindow();

  for (let i = 0; i < 10; i++) {
    const session = auth.pair(secret);

    if (session === null) {
      throw new Error("Pairing failed");
    }

    expect(auth.isSessionValid(session)).toBe(true);
  }

  const session = auth.pair(secret);
  expect(session).toBeNull();
});

// Sessions: expiration boundaries and unknown tokens.
test("session is valid just before expiration", () => {
  const auth = createAuth();
  const { code } = auth.openPairingWindow();
  const session = auth.pair(code);

  if (session === null) {
    throw new Error("Pairing failed");
  }

  vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000 - 1);

  expect(auth.isSessionValid(session)).toBe(true);
});

test("session is invalid at expiration", () => {
  const auth = createAuth();
  const { code } = auth.openPairingWindow();
  const session = auth.pair(code);

  if (session === null) {
    throw new Error("Pairing failed");
  }

  vi.setSystemTime(Date.now() + 24 * 60 * 60 * 1000);

  expect(auth.isSessionValid(session)).toBe(false);
});

test("unknown session is invalid", () => {
  const auth = createAuth();
  expect(auth.isSessionValid("unknown")).toBe(false);
});

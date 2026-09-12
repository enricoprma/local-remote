import { expect, test, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";

import {
  createApi,
  maxPointerDelta,
  maxScrollDelta,
  maxTextLength,
} from "../src/api";
import { createAuth, sessionCookieName } from "../src/auth";
import type { Input } from "../src/input";

function setup() {
  const input = {
    executeAction: vi.fn<Input["executeAction"]>(),
    movePointer: vi.fn<Input["movePointer"]>(),
    scroll: vi.fn<Input["scroll"]>(),
    typeText: vi.fn<Input["typeText"]>(),
  } satisfies Input;

  const auth = createAuth();
  const { code } = auth.openPairingWindow();
  const session = auth.pair(code);

  if (session === null) {
    throw new Error("Test setup failed: pairing did not create a session");
  }

  const app = express();

  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", createApi(input, auth));

  return { input, auth, session, app };
}

// AUTH
test("accepts a valid session", async () => {
  const { session, app } = setup();

  const response = await request(app)
    .get("/api/session")
    .set("Cookie", `${sessionCookieName}=${session}`);

  expect(response.status).toBe(204);
});

test("rejects an unknown session", async () => {
  const { app } = setup();

  const response = await request(app)
    .get("/api/session")
    .set("Cookie", `${sessionCookieName}=unknown`);

  expect(response.status).toBe(401);
});

test.each([
  { route: "/api/pointer", body: { dx: 2, dy: 2 }, method: "movePointer" },
  { route: "/api/scroll", body: { dy: 2 }, method: "scroll" },
  { route: "/api/text", body: { text: "text" }, method: "typeText" },
] as const)(
  "rejects a request without a session for $route",
  async ({ route, body, method }) => {
    const { input, app } = setup();

    const response = await request(app).post(route).send(body);

    expect(response.status).toBe(401);
    expect(input[method]).not.toHaveBeenCalled();
  },
);

test.each(["click", "right-click", "start-drag", "end-drag"])(
  "rejects %s without a session",
  async (action) => {
    const { input, app } = setup();

    const response = await request(app).post("/api/action").send({ action });

    expect(response.status).toBe(401);
    expect(input.executeAction).not.toHaveBeenCalled();
  },
);

// ACTION
test.each(["click", "right-click", "start-drag", "end-drag"])(
  "executes %s exactly once",
  async (action) => {
    const { input, session, app } = setup();

    const response = await request(app)
      .post("/api/action")
      .set("Cookie", `${sessionCookieName}=${session}`)
      .send({ action });

    expect(response.status).toBe(204);
    expect(input.executeAction).toHaveBeenCalledTimes(1);
    expect(input.executeAction).toHaveBeenCalledWith(action);
  },
);

test("rejects an unknown action without executing input", async () => {
  const { input, session, app } = setup();

  const response = await request(app)
    .post("/api/action")
    .set("Cookie", `${sessionCookieName}=${session}`)
    .send({ action: "unknown" });

  expect(response.status).toBe(400);
  expect(input.executeAction).not.toHaveBeenCalled();
});

test("rejects a missing action without executing input", async () => {
  const { input, session, app } = setup();

  const response = await request(app)
    .post("/api/action")
    .set("Cookie", `${sessionCookieName}=${session}`)
    .send({});

  expect(response.status).toBe(400);
  expect(input.executeAction).not.toHaveBeenCalled();
});

// POINTER
test("moves the pointer with valid deltas", async () => {
  const { input, session, app } = setup();

  const response = await request(app)
    .post("/api/pointer")
    .set("Cookie", `${sessionCookieName}=${session}`)
    .send({ dx: maxPointerDelta, dy: -maxPointerDelta });

  expect(response.status).toBe(204);
  expect(input.movePointer).toHaveBeenCalledTimes(1);
  expect(input.movePointer).toHaveBeenCalledWith(
    maxPointerDelta,
    -maxPointerDelta,
  );
});

test.each([
  {
    name: "positive delta above the limit",
    body: { dx: maxPointerDelta + 1, dy: 2 },
  },
  {
    name: "negative delta below the limit",
    body: { dx: 2, dy: -maxPointerDelta - 1 },
  },
  { name: "fractional delta", body: { dx: 1.5, dy: 2 } },
  { name: "zero delta", body: { dx: 0, dy: 0 } },
  { name: "missing delta", body: { dy: 2 } },
  { name: "wrong type for dy", body: { dx: 2, dy: "10" } },
])("rejects invalid pointer input: $name", async ({ body }) => {
  const { input, session, app } = setup();

  const response = await request(app)
    .post("/api/pointer")
    .set("Cookie", `${sessionCookieName}=${session}`)
    .send(body);

  expect(response.status).toBe(400);
  expect(input.movePointer).not.toHaveBeenCalled();
});

// SCROLL
test.each([
  { body: { dy: maxScrollDelta } },
  { body: { dy: -maxScrollDelta } },
])("scrolls with the valid delta $body.dy", async ({ body }) => {
  const { input, session, app } = setup();

  const response = await request(app)
    .post("/api/scroll")
    .set("Cookie", `${sessionCookieName}=${session}`)
    .send(body);

  expect(response.status).toBe(204);
  expect(input.scroll).toHaveBeenCalledTimes(1);
  expect(input.scroll).toHaveBeenCalledWith(body.dy);
});

test.each([
  { name: "positive delta above the limit", body: { dy: maxScrollDelta + 1 } },
  { name: "negative delta below the limit", body: { dy: -maxScrollDelta - 1 } },
  { name: "fractional delta", body: { dy: 1.5 } },
  { name: "zero delta", body: { dy: 0 } },
  { name: "missing delta", body: {} },
])("rejects invalid scroll input: $name", async ({ body }) => {
  const { app, input, session } = setup();

  const response = await request(app)
    .post("/api/scroll")
    .set("Cookie", `${sessionCookieName}=${session}`)
    .send(body);

  expect(response.status).toBe(400);
  expect(input.scroll).not.toHaveBeenCalled();
});

// TEXT
test("types text with valid length", async () => {
  const { input, session, app } = setup();

  const response = await request(app)
    .post("/api/text")
    .set("Cookie", `${sessionCookieName}=${session}`)
    .send({ text: "a".repeat(maxTextLength) });

  expect(response.status).toBe(204);
  expect(input.typeText).toHaveBeenCalledTimes(1);
  expect(input.typeText).toHaveBeenCalledWith("a".repeat(maxTextLength));
});

test.each([
  { name: "empty text", body: { text: "" } },
  {
    name: "excessively long text",
    body: { text: "a".repeat(maxTextLength + 1) },
  },
  { name: "missing text", body: {} },
  { name: "wrong type for text", body: { text: 123 } },
])("rejects invalid text input: $name", async ({ body }) => {
  const { input, session, app } = setup();

  const response = await request(app)
    .post("/api/text")
    .set("Cookie", `${sessionCookieName}=${session}`)
    .send(body);

  expect(response.status).toBe(400);
  expect(input.typeText).not.toHaveBeenCalled();
});

// PAIRING
test("sets a working session cookie after successful pairing", async () => {
  const { app, auth } = setup();
  const { code } = auth.openPairingWindow();

  const agent = request.agent(app);

  // The agent does not have a valid session before pairing.
  const beforePairing = await agent.get("/api/session");
  expect(beforePairing.status).toBe(401);

  const response = await agent.post("/api/pair").send({ credential: code });

  expect(response.status).toBe(204);

  // The agent should now send the session cookie with subsequent requests.
  const afterPairing = await agent.get("/api/session");
  expect(afterPairing.status).toBe(204);
});

test("rejects invalid pairing credentials without setting a cookie", async () => {
  const { app } = setup();

  const response = await request(app)
    .post("/api/pair")
    .send({ credential: "wrong" });

  expect(response.status).toBe(401);
  expect(response.headers["set-cookie"]).toBeUndefined();
});

test.each([
  { name: "missing credential", body: {} },
  { name: "non-string credential", body: { credential: 123 } },
])("rejects pairing with $name without setting a cookie", async ({ body }) => {
  const { app } = setup();

  const response = await request(app).post("/api/pair").send(body);

  expect(response.status).toBe(400);
  expect(response.headers["set-cookie"]).toBeUndefined();
});

// ERROR HANDLING
test("returns a generic server error when input execution fails", async () => {
  const { app, input, session } = setup();

  input.executeAction.mockImplementation(() => {
    throw new Error("Internal with implementation details");
  });

  const response = await request(app)
    .post("/api/action")
    .set("Cookie", `${sessionCookieName}=${session}`)
    .send({ action: "click" });

  expect(response.status).toBe(500);
  expect(response.body).toEqual({
    error: "Input could not be executed",
  });
});

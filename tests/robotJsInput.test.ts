import { afterEach, beforeEach, expect, test, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { createApi } from "../src/api";
import { createAuth, sessionCookieName } from "../src/auth";

const robot = vi.hoisted(() => ({
  mouseToggle: vi.fn(), mouseClick: vi.fn(), moveMouse: vi.fn(), dragMouse: vi.fn(),
  getMousePos: vi.fn(() => ({ x: 100, y: 200 })), keyTap: vi.fn(),
  scrollMouse: vi.fn(), typeString: vi.fn(),
}));
vi.mock("@hurdlegroup/robotjs", () => ({ default: robot }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test.each([false, true])("drag actions reach native input through HTTP (lost start response: %s)", async loseResponse => {
  vi.useRealTimers();
  const { robotJsInput: input } = await import("../src/robotJsInput");
  const remote = await import("../client/services/remote");
  const auth = createAuth();
  const session = auth.pair(auth.openPairingWindow().code);
  if (session === null) throw new Error("Pairing failed");
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", createApi(input, auth));

  // Send real API requests while keeping OS input mocked. A lost response
  // can occur after the server has already pressed the native button.
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (path, options) => {
    if (typeof path !== "string") throw new Error("Expected endpoint path");
    const body = JSON.parse(String(options?.body));
    const response = await request(app).post(path)
      .set("Cookie", `${sessionCookieName}=${session}`).send(body);
    if (loseResponse && body.action === "start-drag") {
      throw new TypeError("Response lost after native press");
    }
    return new Response(null, { status: response.status });
  }));

  try {
    const results = await Promise.allSettled([
      remote.action("start-drag"), remote.movePointer(6, 3), remote.action("end-drag"),
    ]);
    expect(results.map(result => result.status)).toEqual(loseResponse
      ? ["rejected", "rejected", "fulfilled"]
      : ["fulfilled", "fulfilled", "fulfilled"]);
    expect(robot.mouseToggle.mock.calls).toEqual([["down", "left"], ["up", "left"]]);
    if (loseResponse) {
      expect(robot.dragMouse).not.toHaveBeenCalled();
    } else {
      expect(robot.dragMouse).toHaveBeenCalledWith(106, 203);
      expect(robot.mouseToggle.mock.invocationCallOrder[0])
        .toBeLessThan(robot.dragMouse.mock.invocationCallOrder[0]);
      expect(robot.dragMouse.mock.invocationCallOrder[0])
        .toBeLessThan(robot.mouseToggle.mock.invocationCallOrder[1]);
    }
    await remote.movePointer(1, 2);
    expect(robot.moveMouse).toHaveBeenCalledWith(101, 202);
    expect(robot.keyTap).not.toHaveBeenCalled();
  } finally {
    input.executeAction("end-drag");
    vi.useFakeTimers();
  }
});

test("down/up are idempotent and movement chooses the native operation", async () => {
  const { robotJsInput: input } = await import("../src/robotJsInput");
  input.executeAction("end-drag");
  input.movePointer(3, -4);
  input.executeAction("start-drag");
  input.executeAction("start-drag");
  input.movePointer(5, 6);
  input.executeAction("end-drag");
  input.executeAction("end-drag");
  input.movePointer(1, 2);
  expect(robot.mouseToggle.mock.calls).toEqual([["down", "left"], ["up", "left"]]);
  expect(robot.moveMouse.mock.calls).toEqual([[103, 196], [101, 202]]);
  expect(robot.dragMouse.mock.calls).toEqual([[105, 206]]);
});

test("a missing remote release expires after inactivity, with movement extending it", async () => {
  const { robotJsInput: input, pointerIdleTimeoutMs } = await import("../src/robotJsInput");
  input.executeAction("start-drag");
  vi.advanceTimersByTime(pointerIdleTimeoutMs - 1);
  expect(robot.mouseToggle).toHaveBeenCalledTimes(1);
  input.movePointer(1, 2);
  vi.advanceTimersByTime(pointerIdleTimeoutMs - 1);
  expect(robot.mouseToggle).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(1);
  expect(robot.mouseToggle).toHaveBeenLastCalledWith("up", "left");
  input.movePointer(1, 2);
  expect(robot.moveMouse).toHaveBeenCalledTimes(1);
});

test("a failed release keeps the held state and retries native release", async () => {
  const { robotJsInput: input } = await import("../src/robotJsInput");
  input.executeAction("start-drag");
  robot.mouseToggle.mockImplementationOnce(() => { throw new Error("Native failure"); });
  expect(() => input.executeAction("end-drag")).toThrow("Native failure");
  vi.advanceTimersByTime(1000);
  expect(robot.mouseToggle.mock.calls).toEqual([
    ["down", "left"], ["up", "left"], ["up", "left"],
  ]);
  input.executeAction("end-drag");
  expect(robot.mouseToggle).toHaveBeenCalledTimes(3);
});

test("a failed native press still attempts release", async () => {
  const { robotJsInput: input } = await import("../src/robotJsInput");
  robot.mouseToggle.mockImplementationOnce(() => { throw new Error("Press failed"); });
  expect(() => input.executeAction("start-drag")).toThrow("Press failed");
  expect(robot.mouseToggle.mock.calls).toEqual([["down", "left"], ["up", "left"]]);
});

test("a failed drag movement releases held input before reporting the error", async () => {
  const { robotJsInput: input } = await import("../src/robotJsInput");
  input.executeAction("start-drag");
  robot.dragMouse.mockImplementationOnce(() => { throw new Error("Move failed"); });
  expect(() => input.movePointer(1, 2)).toThrow("Move failed");
  expect(robot.mouseToggle).toHaveBeenLastCalledWith("up", "left");
});

test.each(["click", "right-click"] as const)("%s goes through action mapping without leaving held state", async action => {
  const { robotJsInput: input } = await import("../src/robotJsInput");
  input.executeAction("start-drag");
  input.executeAction(action);
  input.movePointer(1, 2);
  expect(robot.mouseToggle).toHaveBeenLastCalledWith("up", "left");
  expect(robot.mouseClick).toHaveBeenCalledWith(action === "click" ? "left" : "right");
  expect(robot.moveMouse).toHaveBeenCalled();
  expect(robot.dragMouse).not.toHaveBeenCalled();
});

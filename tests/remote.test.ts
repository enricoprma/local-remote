import { afterEach, beforeEach, expect, test, vi } from "vitest";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

function controlFetch() {
  const responses: Array<(response: Response) => void> = [];
  const failures: Array<(error: Error) => void> = [];
  const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>((resolve, reject) => {
    responses.push(resolve);
    failures.push(reject);
  }));
  vi.stubGlobal("fetch", fetch);
  return { fetch, responses, failures };
}

// Allow the promise chain to advance without using a wall-clock wait.
async function flush() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

test("a movement burst during a slow request needs only one more movement before release", async () => {
  const { fetch, responses } = controlFetch();
  const remote = await import("../client/services/remote");
  const firstMove = remote.movePointer(4, 5);
  await flush();

  const moves = Array.from({ length: 200 }, () => remote.movePointer(2, -1));
  const completed = Promise.all([firstMove, ...moves, remote.action("end-drag")]);
  expect(fetch).toHaveBeenCalledTimes(1);
  responses[0](new Response(null, { status: 204 }));
  await flush();
  expect(fetch.mock.calls[1][0]).toBe("/api/pointer");
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ dx: 400, dy: -200 });
  responses[1](new Response(null, { status: 204 }));
  await flush();
  expect(fetch.mock.calls[2][0]).toBe("/api/action");
  responses[2](new Response(null, { status: 204 }));
  await completed;
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("concurrent callers preserve command order while combining adjacent moves", async () => {
  const { fetch, responses } = controlFetch();
  const remote = await import("../client/services/remote");
  const completed = Promise.all([
    remote.action("click"), remote.action("start-drag"), remote.movePointer(4, 5),
    remote.movePointer(-2, 1), remote.action("end-drag"), remote.action("right-click"),
    remote.scroll(3), remote.typeText("hello"), remote.action("enter"),
  ]);

  const paths = ["action", "action", "pointer",
    "action", "action", "scroll", "text", "action"];
  for (let i = 0; i < paths.length; i++) {
    await flush();
    expect(fetch).toHaveBeenCalledTimes(i + 1);
    expect(fetch.mock.calls[i][0]).toBe(`/api/${paths[i]}`);
    responses[i](new Response(null, { status: 204 }));
  }
  await completed;
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ action: "start-drag" });
  expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).toEqual({ dx: 2, dy: 6 });
  expect(JSON.parse(String(fetch.mock.calls[3][1]?.body))).toEqual({ action: "end-drag" });
  expect(fetch.mock.calls[3][1]?.keepalive).toBe(true);
  expect(fetch.mock.calls[1][1]?.keepalive).not.toBe(true);
});

test("movement never combines across drag boundaries or discrete commands", async () => {
  const { fetch, responses } = controlFetch();
  const remote = await import("../client/services/remote");
  const completed = Promise.all([
    remote.movePointer(2, 3), remote.action("start-drag"), remote.movePointer(4, 5),
    remote.action("end-drag"), remote.movePointer(6, 7), remote.action("click"),
    remote.movePointer(8, 9), remote.scroll(2), remote.movePointer(10, 11),
  ]);
  const commands = [
    ["pointer", { dx: 2, dy: 3 }], ["action", { action: "start-drag" }], ["pointer", { dx: 4, dy: 5 }],
    ["action", { action: "end-drag" }], ["pointer", { dx: 6, dy: 7 }], ["action", { action: "click" }],
    ["pointer", { dx: 8, dy: 9 }], ["scroll", { dy: 2 }], ["pointer", { dx: 10, dy: 11 }],
  ];
  for (let i = 0; i < commands.length; i++) {
    await flush();
    expect(fetch).toHaveBeenCalledTimes(i + 1);
    expect(fetch.mock.calls[i][0]).toBe(`/api/${commands[i][0]}`);
    expect(JSON.parse(String(fetch.mock.calls[i][1]?.body))).toEqual(commands[i][1]);
    responses[i](new Response(null, { status: 204 }));
  }
  await completed;
});

test("scroll bursts combine without changing the request already in flight", async () => {
  const { fetch, responses } = controlFetch();
  const remote = await import("../client/services/remote");
  const first = remote.scroll(2);
  await flush();
  const completed = Promise.all([first, remote.scroll(3), remote.scroll(-1), remote.scroll(4)]);
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ dy: 2 });
  responses[0](new Response(null, { status: 204 }));
  await flush();
  expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ dy: 6 });
  responses[1](new Response(null, { status: 204 }));
  await completed;
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("combined deltas stay within API limits without queuing excess movement", async () => {
  const { fetch, responses } = controlFetch();
  const remote = await import("../client/services/remote");
  const completed = Promise.all([
    remote.movePointer(400, -300), remote.movePointer(200, -300),
    remote.scroll(-15), remote.scroll(-15), remote.action("end-drag"),
  ]);
  const bodies = [{ dx: 500, dy: -500 }, { dy: -20 }, {action: "end-drag"}];
  for (let i = 0; i < bodies.length; i++) {
    await flush();
    expect(JSON.parse(String(fetch.mock.calls[i][1]?.body))).toEqual(bodies[i]);
    responses[i](new Response(null, { status: 204 }));
  }
  await completed;
  expect(fetch).toHaveBeenCalledTimes(3);
});

test("direction changes sum before clamping and zero movement sends no invalid request", async () => {
  const { fetch, responses } = controlFetch();
  const remote = await import("../client/services/remote");
  const completed = Promise.all([
    remote.movePointer(400, 0), remote.movePointer(400, 0), remote.movePointer(-500, 0),
    remote.scroll(10), remote.scroll(-10), remote.movePointer(2, 3),
    remote.movePointer(-2, -3), remote.action("end-drag"),
  ]);
  await flush();
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({ dx: 300, dy: 0 });
  responses[0](new Response(null, { status: 204 }));
  await flush();
  expect(fetch.mock.calls[1][0]).toBe("/api/action");
  responses[1](new Response(null, { status: 204 }));
  await completed;
  expect(fetch).toHaveBeenCalledTimes(2);
});

test.each([401, 500, "network"] as const)(
  "%s failure drops queued movement but still sends release and allows recovery", async failure => {
    const { fetch, responses, failures } = controlFetch();
    const remote = await import("../client/services/remote");
    const completed = Promise.allSettled([
      remote.action("start-drag"), remote.movePointer(2, 3), remote.movePointer(1, 1),
      remote.action("click"), remote.action("end-drag"),
    ]);
    await flush();
    if (failure === "network") failures[0](new TypeError("Network error"));
    else responses[0](new Response(null, { status: failure }));
    await flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][0]).toBe("/api/action");
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ action: "end-drag" });
    expect(fetch.mock.calls[1][1]?.keepalive).toBe(true);
    responses[1](new Response(null, { status: 204 }));
    expect((await completed).map(result => result.status))
      .toEqual(["rejected", "rejected", "rejected", "rejected", "fulfilled"]);

    const retry = remote.action("right-click");
    await flush();
    expect(fetch).toHaveBeenCalledTimes(3);
    responses[2](new Response(null, { status: 204 }));
    await retry;
  },
);

test("an aborted request also advances the queue to the release", async () => {
  const { fetch, responses, failures } = controlFetch();
  const timeoutSignal = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutSignal.signal);
  try {
    const remote = await import("../client/services/remote");
    const completed = Promise.allSettled([remote.action("start-drag"), remote.action("end-drag")]);
    await flush();
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(fetch.mock.calls[0][1]?.signal).toBe(timeoutSignal.signal);
    timeoutSignal.abort();
    failures[0](new DOMException("Timed out", "TimeoutError"));
    await flush();
    expect(fetch.mock.calls[1][0]).toBe("/api/action");
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({ action: "end-drag" });
    responses[1](new Response(null, { status: 204 }));
    await completed;
  } finally {
    timeout.mockRestore();
  }
});

import express, { type ErrorRequestHandler } from "express";
import { networkInterfaces } from "node:os";
import path from "node:path";

import { isRemoteAction } from "./actions";
import { executeAction, movePointer, scroll, typeText } from "./input";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const maxTextLength = 500;
const maxPointerDelta = 500;
const maxScrollDelta = 20;

app.use(express.json({ limit: "2kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.post("/api/action", (request, response) => {
  const body: unknown = request.body;

  if (!isRecord(body) || !isRemoteAction(body.action)) {
    response.status(400).json({ error: "Invalid action" });
    return;
  }

  // RobotJS is synchronous; only acknowledge the request after execution returns.
  executeAction(body.action);
  response.sendStatus(204);
});

app.post("/api/pointer", (request, response) => {
  const body: unknown = request.body;

  if (!isPointerMovement(body)) {
    response.status(400).json({ error: "Invalid pointer movement" });
    return;
  }

  movePointer(body.dx, body.dy);
  response.sendStatus(204);
});

app.post("/api/scroll", (request, response) => {
  const body: unknown = request.body;

  if (!isScrollMovement(body)) {
    response.status(400).json({ error: "Invalid scroll movement" });
    return;
  }

  scroll(body.dy);
  response.sendStatus(204);
});

app.post("/api/text", (request, response) => {
  const body: unknown = request.body;

  if (
    !isRecord(body) ||
    typeof body.text !== "string" ||
    body.text.length === 0 ||
    body.text.length > maxTextLength
  ) {
    response.status(400).json({ error: "Invalid text" });
    return;
  }

  typeText(body.text);
  response.sendStatus(204);
});

const handleError: ErrorRequestHandler = (error, _request, response, _next) => {
  if (isClientRequestError(error)) {
    response.status(400).json({ error: "Invalid request body" });
    return;
  }

  console.error(
    "Input execution failed:",
    error instanceof Error ? error.message : error,
  );
  response.status(500).json({ error: "Input could not be executed" });
};

app.use(handleError);

app.listen(port, "0.0.0.0", () => {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);

  console.log("Local Remote running:\n");
  console.log(`http://localhost:${port}`);

  for (const address of addresses) {
    console.log(`http://${address}:${port}`);
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPointerMovement(
  value: unknown,
): value is { dx: number; dy: number } {
  if (!isRecord(value)) {
    return false;
  }

  const { dx, dy } = value;

  return isPointerDelta(dx) && isPointerDelta(dy) && (dx !== 0 || dy !== 0);
}

function isPointerDelta(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Math.abs(value) <= maxPointerDelta
  );
}

function isScrollMovement(value: unknown): value is { dy: number } {
  if (!isRecord(value)) {
    return false;
  }

  const { dy } = value;

  return (
    typeof dy === "number" &&
    Number.isInteger(dy) &&
    dy !== 0 &&
    Math.abs(dy) <= maxScrollDelta
  );
}

function isClientRequestError(error: unknown): boolean {
  if (!isRecord(error) || typeof error.status !== "number") {
    return false;
  }

  return error.status >= 400 && error.status < 500;
}

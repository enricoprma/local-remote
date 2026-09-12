import express, { ErrorRequestHandler } from "express";
import { Input } from "./input";
import { isRemoteAction } from "./actions";
import { Auth, sessionCookieName, sessionDurationMs } from "./auth";

// Request limits to prevent excessively large or unintended input commands.
export const maxTextLength = 500;
export const maxPointerDelta = 500;
export const maxScrollDelta = 20;

export function createApi(input: Input, auth: Auth) {
  const router = express.Router();

  // Exchange a short-lived pairing secret for an authenticated session.
  router.post("/pair", (request, response) => {
    const body: unknown = request.body;
    const client = request.socket.remoteAddress ?? "unknown";

    console.log(`[api] Pairing request from ${client}`);

    if (!isRecord(body) || typeof body.credential !== "string") {
      console.warn(`[api] Rejected invalid pairing request from ${client}`);

      response.status(400).json({ error: "Invalid pairing request" });

      return;
    }

    const session = auth.pair(body.credential);

    if (session === null) {
      console.warn(
        `[api] Pairing failed for ${client}: invalid or expired credential`,
      );

      response.status(401).json({
        error: "Invalid or expired pairing secret",
      });

      return;
    }

    response.cookie(sessionCookieName, session, {
      httpOnly: true,
      sameSite: "strict",
      path: "/api",
      maxAge: sessionDurationMs,
    });

    console.log(`[api] Pairing successful for ${client}`);

    response.sendStatus(204);
  });

  // All API routes below this middleware require a valid session cookie.
  router.use((request, response, next) => {
    const session: unknown = request.cookies?.[sessionCookieName];

    if (typeof session !== "string" || !auth.isSessionValid(session)) {
      const client = request.socket.remoteAddress ?? "unknown";

      console.warn(
        `[api] Unauthorized ${request.method} ${request.originalUrl} from ${client}`,
      );

      response.sendStatus(401);
      return;
    }

    next();
  });

  router.get("/session", (_request, response) => {
    response.sendStatus(204);
  });

  // Execute one of the predefined remote actions, such as click,
  // volume control, or navigation keys.
  router.post("/action", (request, response) => {
    const body: unknown = request.body;

    if (!isRecord(body) || !isRemoteAction(body.action)) {
      response.status(400).json({ error: "Invalid action" });
      return;
    }

    input.executeAction(body.action);

    response.sendStatus(204);
  });

  // Move the pointer relative to its current position.
  router.post("/pointer", (request, response) => {
    const body: unknown = request.body;

    if (!isPointerMovement(body)) {
      response.status(400).json({ error: "Invalid pointer movement" });
      return;
    }

    input.movePointer(body.dx, body.dy);

    response.sendStatus(204);
  });

  // Scroll vertically using a bounded relative delta.
  router.post("/scroll", (request, response) => {
    const body: unknown = request.body;

    if (!isScrollMovement(body)) {
      response.status(400).json({ error: "Invalid scroll movement" });
      return;
    }

    input.scroll(body.dy);

    response.sendStatus(204);
  });

  // Type arbitrary text on the host machine.
  router.post("/text", (request, response) => {
    const body: unknown = request.body;

    // Reject invalid, empty, or excessively long text payloads.
    if (
      !isRecord(body) ||
      typeof body.text !== "string" ||
      body.text.length === 0 ||
      body.text.length > maxTextLength
    ) {
      response.status(400).json({ error: "Invalid text" });
      return;
    }

    input.typeText(body.text);

    response.sendStatus(204);
  });

  // Central error handler for API routes.
  // Client-side request errors are returned as 400 responses,
  // while unexpected execution errors are hidden behind a generic 500 response.
  const handleError: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    if (isClientRequestError(error)) {
      response.status(400).json({ error: "Invalid request body" });
      return;
    }

    // Log the internal error without exposing implementation details to the client.
    console.error(
      "[api] Input execution failed:",
      error instanceof Error ? error.message : error,
    );

    response.status(500).json({ error: "Input could not be executed" });
  };

  router.use(handleError);

  return router;
}

// Runtime guard for plain object request bodies.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Validate the structure and bounds of a pointer movement request.
function isPointerMovement(
  value: unknown,
): value is { dx: number; dy: number } {
  if (!isRecord(value)) {
    return false;
  }

  const { dx, dy } = value;

  return isPointerDelta(dx) && isPointerDelta(dy) && (dx !== 0 || dy !== 0);
}

// Pointer deltas must be integers within the configured movement limit.
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

// Detect request errors generated by Express or body-parsing middleware.
function isClientRequestError(error: unknown): boolean {
  if (!isRecord(error) || typeof error.status !== "number") {
    return false;
  }

  return error.status >= 400 && error.status < 500;
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  // The API intentionally returns 204 for successful commands.
  requireSuccess(response);
}

export function pair(credential) {
  return post("/api/pair", { credential });
}

export function action(action) {
  return post("/api/action", { action });
}

export function movePointer(dx, dy) {
  return post("/api/pointer", { dx, dy });
}

export function scroll(dy) {
  return post("/api/scroll", { dy });
}

export function typeText(text) {
  return post("/api/text", { text });
}

export async function hasSession() {
  const response = await fetch("/api/session");

  if (response.status === 401) {
    return false;
  }

  requireSuccess(response);
  return true;
}

function requireSuccess(response) {
  if (response.ok) {
    return;
  }

  throw Object.assign(
    new Error(
      `Request failed with status ${response.status}`,
    ),
    { status: response.status },
  );
}
async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // Commands intentionally return 204, so successful responses have no body.
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
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

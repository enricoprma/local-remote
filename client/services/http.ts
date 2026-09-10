export class HttpError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Request failed with status ${status}`);
    this.name = "HttpError";
    this.status = status;
  }
}

export function get(path: string): Promise<void> {
  return request(path, {
    method: "GET",
  });
}

export function post(
  path: string,
  body: unknown,
): Promise<void> {
  return request(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

async function request(
  path: string,
  options: RequestInit,
): Promise<void> {
  const response = await fetch(path, options);

  if (!response.ok) {
    throw new HttpError(response.status);
  }
}

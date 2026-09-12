import { endpoints } from "./endpoints.js";
import { get, HttpError, post } from "./http.js";

export async function hasSession(): Promise<boolean> {
  try {
    await get(endpoints.session);
    return true;
  } catch (error: unknown) {
    if (error instanceof HttpError && error.status === 401) {
      return false;
    }

    throw error;
  }
}

export function pairWithCredential(credential: string): Promise<void> {
  return post(endpoints.pair, { credential });
}

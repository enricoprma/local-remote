import { randomBytes, randomInt } from "node:crypto";

export const sessionCookieName = "local-remote-session";

export const sessionDurationMs = 24 * 60 * 60 * 1000; // 24 hours

const pairingDurationMs = 2 * 60 * 1000; // 2 minutes
const maxPairingsPerWindow = 10;

type PairingWindow = {
  secret: string;
  code: string;
  expiresAt: number;
  pairings: number;
};

export interface PairingCredentials {
  secret: string;
  code: string;
}

export interface Auth {
  openPairingWindow(): PairingCredentials;
  closePairingWindow(): void;
  pair(credential: string): string | null;
  isSessionValid(session: string): boolean;
}

export function createAuth(): Auth {
  let pairingWindow: PairingWindow | null = null;

  const sessions = new Map<string, number>();

  return {
    openPairingWindow() {
      const secret = randomBytes(32).toString("base64url");

      const code = randomInt(100000, 1000000).toString();

      console.log("[auth] Code is " + code);

      pairingWindow = {
        secret,
        code,
        expiresAt: Date.now() + pairingDurationMs,
        pairings: 0,
      };

      console.log(
        `[auth] Pairing window opened for ${pairingDurationMs / 1000}s`,
      );

      return { secret, code };
    },

    closePairingWindow() {
      pairingWindow = null;

      console.log("[auth] Pairing window closed");
    },

    pair(credential) {
      if (pairingWindow === null) {
        console.warn("[auth] Pairing rejected: no pairing window open");

        return null;
      }

      if (pairingWindow.expiresAt <= Date.now()) {
        pairingWindow = null;

        console.warn("[auth] Pairing rejected: pairing window expired");

        return null;
      }

      if (pairingWindow.pairings >= maxPairingsPerWindow) {
        console.warn("[auth] Pairing rejected: pairing limit reached");

        return null;
      }

      const matchesSecret = credential === pairingWindow.secret;

      const matchesCode = credential === pairingWindow.code;

      if (!matchesSecret && !matchesCode) {
        console.warn("[auth] Pairing rejected: credential does not match");

        return null;
      }

      pairingWindow.pairings++;

      const session = randomBytes(32).toString("base64url");

      sessions.set(session, Date.now() + sessionDurationMs);

      console.log(
        `[auth] Session created (${pairingWindow.pairings}/${maxPairingsPerWindow} pairings used)`,
      );

      return session;
    },

    isSessionValid(session) {
      const expiresAt = sessions.get(session);

      if (expiresAt === undefined) {
        return false;
      }

      if (expiresAt <= Date.now()) {
        sessions.delete(session);

        console.log("[auth] Expired session removed");

        return false;
      }

      return true;
    },
  };
}

// One shared runtime instance.
//
// Electron and the Express server run in the same Electron main process,
// so both can use this instance.
export const auth = createAuth();

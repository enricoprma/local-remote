import { networkInterfaces } from "node:os";

export const port = Number(process.env.PORT ?? 3000);

export const mdnsHostname = "local-remote.local";

export const mdnsUrl = `http://${mdnsHostname}:${port}`;

export function getLocalAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

export function getLocalUrls(): string[] {
  return getLocalAddresses().map((address) => `http://${address}:${port}`);
}

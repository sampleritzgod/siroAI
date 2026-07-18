import { randomBytes } from "node:crypto";

/** URL-safe opaque token for public share links. */
export function createShareToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

export function isShareTokenFormat(token: string) {
  return /^[A-Za-z0-9_-]{16,128}$/.test(token);
}

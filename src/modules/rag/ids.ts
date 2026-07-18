import { randomBytes } from "node:crypto";

/** cuid-like id without adding a dependency. */
export function createId() {
  return `c${Date.now().toString(36)}${randomBytes(8).toString("hex")}`;
}

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createShareToken, isShareTokenFormat } from "./share-token";

describe("share-token", () => {
  it("creates URL-safe opaque tokens", () => {
    const token = createShareToken();
    assert.equal(isShareTokenFormat(token), true);
    assert.match(token, /^[A-Za-z0-9_-]+$/);
    assert.ok(token.length >= 16);
  });

  it("rejects short or invalid tokens", () => {
    assert.equal(isShareTokenFormat("short"), false);
    assert.equal(isShareTokenFormat("has spaces!!"), false);
    assert.equal(isShareTokenFormat(""), false);
  });
});

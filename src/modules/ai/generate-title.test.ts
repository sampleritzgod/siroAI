import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  sanitizeGeneratedTitle,
  shouldReplaceAutoTitle,
} from "./generate-title";

describe("shouldReplaceAutoTitle", () => {
  it("replaces default and truncated titles", () => {
    assert.equal(shouldReplaceAutoTitle("New Chat", "Hello world"), true);
    assert.equal(
      shouldReplaceAutoTitle("Hello world".slice(0, 48), "Hello world"),
      true
    );
  });

  it("keeps manually renamed titles", () => {
    assert.equal(
      shouldReplaceAutoTitle("Project kickoff notes", "Hello world"),
      false
    );
  });
});

describe("sanitizeGeneratedTitle", () => {
  it("strips quotes and collapses whitespace", () => {
    assert.equal(
      sanitizeGeneratedTitle('  "Hello   there"  '),
      "Hello there"
    );
  });

  it("returns null for empty output", () => {
    assert.equal(sanitizeGeneratedTitle("   "), null);
  });
});

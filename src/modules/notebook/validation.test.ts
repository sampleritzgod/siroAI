import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  NOTEBOOK_TITLE_MAX_LENGTH,
  validateNotebookDescription,
  validateNotebookTitle,
} from "@/modules/notebook/validation";

describe("validateNotebookTitle", () => {
  it("accepts a trimmed title", () => {
    const result = validateNotebookTitle("  Research notes  ");
    assert.deepEqual(result, { ok: true, title: "Research notes" });
  });

  it("rejects empty and whitespace-only titles", () => {
    assert.equal(validateNotebookTitle("").ok, false);
    assert.equal(validateNotebookTitle("   ").ok, false);
    assert.equal(validateNotebookTitle(null).ok, false);
    assert.equal(validateNotebookTitle(undefined).ok, false);
    assert.equal(validateNotebookTitle(42).ok, false);
  });

  it("rejects titles longer than 100 characters", () => {
    const tooLong = "a".repeat(NOTEBOOK_TITLE_MAX_LENGTH + 1);
    const result = validateNotebookTitle(tooLong);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /at most 100/);
    }
  });

  it("accepts titles at the max length", () => {
    const exact = "a".repeat(NOTEBOOK_TITLE_MAX_LENGTH);
    const result = validateNotebookTitle(exact);
    assert.deepEqual(result, { ok: true, title: exact });
  });
});

describe("validateNotebookDescription", () => {
  it("normalizes blank descriptions to null", () => {
    assert.deepEqual(validateNotebookDescription(""), {
      ok: true,
      description: null,
    });
    assert.deepEqual(validateNotebookDescription("   "), {
      ok: true,
      description: null,
    });
    assert.deepEqual(validateNotebookDescription(null), {
      ok: true,
      description: null,
    });
    assert.deepEqual(validateNotebookDescription(undefined), {
      ok: true,
      description: null,
    });
  });

  it("trims non-empty descriptions", () => {
    assert.deepEqual(validateNotebookDescription("  hello  "), {
      ok: true,
      description: "hello",
    });
  });

  it("rejects non-string descriptions", () => {
    const result = validateNotebookDescription(123);
    assert.equal(result.ok, false);
  });
});

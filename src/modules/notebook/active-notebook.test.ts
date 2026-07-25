import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveActiveNotebookId } from "@/modules/notebook/active-notebook";

describe("resolveActiveNotebookId", () => {
  it("returns null when there are no notebooks", () => {
    assert.equal(resolveActiveNotebookId([], "any"), null);
  });

  it("prefers a persisted id that still exists", () => {
    const notebooks = [{ id: "a" }, { id: "b" }];
    assert.equal(resolveActiveNotebookId(notebooks, "b"), "b");
  });

  it("falls back to the first notebook when preferred is missing", () => {
    const notebooks = [{ id: "a" }, { id: "b" }];
    assert.equal(resolveActiveNotebookId(notebooks, "gone"), "a");
    assert.equal(resolveActiveNotebookId(notebooks, null), "a");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readPendingNotebookId,
  resolveActiveNotebookId,
  writePendingNotebookId,
} from "@/modules/notebook/active-notebook";

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

describe("pending notebook switch", () => {
  it("stores and clears an in-memory pending notebook id", () => {
    writePendingNotebookId(null);
    assert.equal(readPendingNotebookId(), null);

    writePendingNotebookId("chess");
    assert.equal(readPendingNotebookId(), "chess");

    writePendingNotebookId("chess");
    assert.equal(readPendingNotebookId(), "chess");

    writePendingNotebookId(null);
    assert.equal(readPendingNotebookId(), null);
  });

  it("lets pending win over a stale conversation notebook id", () => {
    const notebooks = [{ id: "practial" }, { id: "chess" }];
    const pending = "chess";
    const conversationNotebookId = "practial";
    const stored = "practial";

    assert.equal(
      resolveActiveNotebookId(
        notebooks,
        pending ?? conversationNotebookId ?? stored
      ),
      "chess"
    );
  });
});

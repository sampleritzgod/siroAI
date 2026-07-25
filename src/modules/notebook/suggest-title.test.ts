import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { suggestNextNotebookTitle } from "@/modules/notebook/suggest-title";

describe("suggestNextNotebookTitle", () => {
  it("uses Untitled notebook when free", () => {
    assert.equal(suggestNextNotebookTitle([]), "Untitled notebook");
    assert.equal(
      suggestNextNotebookTitle(["My Notebook"]),
      "Untitled notebook"
    );
  });

  it("increments when Untitled notebook is taken", () => {
    assert.equal(
      suggestNextNotebookTitle(["Untitled notebook"]),
      "Untitled notebook 2"
    );
    assert.equal(
      suggestNextNotebookTitle([
        "Untitled notebook",
        "Untitled notebook 2",
        "Research",
      ]),
      "Untitled notebook 3"
    );
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isNotebookIndexing,
  isNotebookReady,
  isSourceReady,
} from "@/modules/notebook/notebook-readiness";
import type { SourceListItem } from "@/modules/source/service";

function source(
  overrides: Partial<SourceListItem> &
    Pick<SourceListItem, "id" | "indexingStatus" | "hasExtractedText">
): SourceListItem {
  return {
    notebookId: "nb",
    type: "TEXT",
    title: "Doc",
    originalFileName: "doc.txt",
    mimeType: "text/plain",
    fileSize: 10,
    url: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("notebook readiness", () => {
  it("treats INDEXED sources as ready", () => {
    assert.equal(
      isSourceReady(
        source({ id: "1", indexingStatus: "INDEXED", hasExtractedText: true })
      ),
      true
    );
  });

  it("does not treat PENDING sources as ready without embeddings", () => {
    assert.equal(
      isSourceReady(
        source({ id: "1", indexingStatus: "PENDING", hasExtractedText: true })
      ),
      false
    );
  });

  it("requires at least one INDEXED source for notebook readiness", () => {
    assert.equal(isNotebookReady([]), false);
    assert.equal(
      isNotebookReady([
        source({
          id: "1",
          indexingStatus: "PROCESSING",
          hasExtractedText: false,
        }),
      ]),
      false
    );
    assert.equal(
      isNotebookReady([
        source({ id: "1", indexingStatus: "PENDING", hasExtractedText: true }),
      ]),
      false
    );
    assert.equal(
      isNotebookReady([
        source({ id: "1", indexingStatus: "INDEXED", hasExtractedText: true }),
      ]),
      true
    );
  });

  it("detects in-progress indexing", () => {
    assert.equal(
      isNotebookIndexing([
        source({
          id: "1",
          indexingStatus: "PROCESSING",
          hasExtractedText: false,
        }),
      ]),
      true
    );
    assert.equal(
      isNotebookIndexing([
        source({ id: "1", indexingStatus: "INDEXED", hasExtractedText: true }),
      ]),
      false
    );
  });
});

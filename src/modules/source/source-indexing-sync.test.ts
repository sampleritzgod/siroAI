import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SourceListItem } from "@/modules/source/service";
import {
  hasSourcesIndexing,
  indexingPollBackoffMs,
  mergeSourceLists,
  preferSourceStatus,
  SOURCE_INDEXING_POLL_MS,
} from "@/modules/source/source-indexing-sync";

function source(
  overrides: Partial<SourceListItem> &
    Pick<SourceListItem, "id" | "indexingStatus">
): SourceListItem {
  return {
    notebookId: "nb",
    type: "TEXT",
    title: "Doc",
    originalFileName: "doc.txt",
    mimeType: "text/plain",
    fileSize: 10,
    url: null,
    metadata: null,
    hasExtractedText: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("source indexing sync", () => {
  it("detects in-flight sources even when another is INDEXED", () => {
    assert.equal(
      hasSourcesIndexing([
        source({ id: "1", indexingStatus: "INDEXED" }),
        source({ id: "2", indexingStatus: "PROCESSING" }),
      ]),
      true
    );
    assert.equal(
      hasSourcesIndexing([source({ id: "1", indexingStatus: "INDEXED" })]),
      false
    );
  });

  it("never downgrades INDEXED to PROCESSING from a stale payload", () => {
    const indexed = source({
      id: "1",
      indexingStatus: "INDEXED",
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const stale = source({
      id: "1",
      indexingStatus: "PROCESSING",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    assert.equal(preferSourceStatus(indexed, stale).indexingStatus, "INDEXED");
  });

  it("upgrades PROCESSING to INDEXED from a poll", () => {
    const processing = source({ id: "1", indexingStatus: "PROCESSING" });
    const indexed = source({
      id: "1",
      indexingStatus: "INDEXED",
      updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    });
    assert.equal(
      preferSourceStatus(processing, indexed).indexingStatus,
      "INDEXED"
    );
  });

  it("patches only matching sources when merging lists", () => {
    const local = [
      source({ id: "1", indexingStatus: "PROCESSING", title: "A" }),
      source({ id: "2", indexingStatus: "INDEXED", title: "B" }),
    ];
    const incoming = [
      source({ id: "1", indexingStatus: "INDEXED", title: "A" }),
    ];
    const merged = mergeSourceLists(local, incoming);
    assert.equal(merged.length, 1);
    assert.equal(merged[0]?.indexingStatus, "INDEXED");
  });

  it("keeps optimistic in-flight rows missing from a partial race", () => {
    const local = [
      source({ id: "new", indexingStatus: "PROCESSING", title: "New" }),
      source({ id: "1", indexingStatus: "INDEXED", title: "A" }),
    ];
    const incoming = [
      source({ id: "1", indexingStatus: "INDEXED", title: "A" }),
    ];
    const merged = mergeSourceLists(local, incoming);
    assert.equal(merged.length, 2);
    assert.equal(merged[0]?.id, "new");
    assert.equal(merged[1]?.id, "1");
  });

  it("backs off exponentially then caps", () => {
    assert.equal(indexingPollBackoffMs(0), SOURCE_INDEXING_POLL_MS);
    assert.equal(indexingPollBackoffMs(1), 2000);
    assert.equal(indexingPollBackoffMs(2), 4000);
    assert.equal(indexingPollBackoffMs(3), 8000);
    assert.equal(indexingPollBackoffMs(10), 30_000);
  });
});

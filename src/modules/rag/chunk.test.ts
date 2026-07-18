import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chunkText } from "@/modules/rag/chunk";

describe("chunkText", () => {
  it("returns empty for blank input", () => {
    assert.deepEqual(chunkText("   "), []);
  });

  it("keeps short text as one chunk", () => {
    const chunks = chunkText("hello world");
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0]?.content, "hello world");
  });

  it("splits long text with overlap continuity", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence ${i}.`).join(
      " "
    );
    const chunks = chunkText(text, { chunkSize: 80, overlap: 20 });
    assert.ok(chunks.length > 1);
    assert.equal(chunks[0]?.index, 0);
    assert.equal(chunks[1]?.index, 1);
  });
});

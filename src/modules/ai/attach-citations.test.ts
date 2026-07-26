import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createUIMessageStream,
  readUIMessageStream,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import { withCitationsPart } from "@/modules/ai/attach-citations";
import {
  CITATIONS_PART_TYPE,
  readCitationsFromParts,
  type MessageCitation,
} from "@/modules/rag/citation-types";

const citation: MessageCitation = {
  index: 1,
  chunkId: "chunk_1",
  sourceId: "src_1",
  attachmentId: null,
  filename: "notes.pdf",
  sourceType: "PDF",
  chunkIndex: 0,
  score: 0.72,
  page: null,
  url: null,
  snippet: "photosynthesis",
};

function messages(): UIMessage[] {
  return [
    { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
    { id: "a1", role: "assistant", parts: [{ type: "text", text: "hello [1]" }] },
  ];
}

describe("withCitationsPart", () => {
  it("appends citations to the last assistant message", () => {
    const result = withCitationsPart(messages(), [citation]);

    assert.equal(result[0]?.parts.length, 1, "user message untouched");
    assert.equal(result[1]?.parts.length, 2);
    assert.deepEqual(readCitationsFromParts(result[1]!.parts), [citation]);
  });

  it("is a no-op without citations", () => {
    const input = messages();
    assert.equal(withCitationsPart(input, []), input);
  });

  it("does not duplicate an existing citations part", () => {
    const once = withCitationsPart(messages(), [citation]);
    const twice = withCitationsPart(once, [citation]);

    assert.equal(
      twice[1]?.parts.filter((part) => part.type === CITATIONS_PART_TYPE).length,
      1
    );
  });

  it("leaves messages alone when there is no assistant turn", () => {
    const userOnly: UIMessage[] = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
    ];
    assert.equal(withCitationsPart(userOnly, [citation]), userOnly);
  });
});

/** Mirrors how /api/chat merges citations into the assistant stream. */
describe("citations data part on the UI message stream", () => {
  it("streams citations alongside the assistant text", async () => {
    const assistantChunks: UIMessageChunk[] = [
      { type: "start" },
      { type: "start-step" },
      { type: "text-start", id: "t1" },
      { type: "text-delta", id: "t1", delta: "Plants use light [1]." },
      { type: "text-end", id: "t1" },
      { type: "finish-step" },
      { type: "finish" },
    ];

    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({
          type: CITATIONS_PART_TYPE,
          id: "citations",
          data: [citation],
        });
        writer.merge(
          new ReadableStream<UIMessageChunk>({
            start(controller) {
              for (const chunk of assistantChunks) controller.enqueue(chunk);
              controller.close();
            },
          })
        );
      },
    });

    let final: UIMessage | null = null;
    for await (const message of readUIMessageStream({ stream })) {
      final = message;
    }

    assert.ok(final);
    assert.deepEqual(readCitationsFromParts(final.parts), [citation]);
    assert.equal(
      final.parts
        .filter((part) => part.type === "text")
        .map((part) => (part as { text: string }).text)
        .join(""),
      "Plants use light [1]."
    );
  });
});

describe("readCitationsFromParts", () => {
  it("returns [] when the turn has no citations", () => {
    assert.deepEqual(readCitationsFromParts([{ type: "text" }]), []);
  });

  it("ignores malformed citation payloads", () => {
    assert.deepEqual(
      readCitationsFromParts([
        { type: CITATIONS_PART_TYPE, data: [{ index: "nope" }] },
      ]),
      []
    );
    assert.deepEqual(
      readCitationsFromParts([{ type: CITATIONS_PART_TYPE, data: "bad" }]),
      []
    );
  });
});

import "@/modules/notebook/load-test-env";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { createConversationForUser } from "@/modules/conversation/create-conversation";
import { createNotebookForUser } from "@/modules/notebook/service";
import { EMBEDDING_DIMENSIONS } from "@/modules/rag/embed";
import {
  countSourceChunks,
  notebookHasIndexedChunks,
} from "@/modules/rag/index-source";
import {
  formatRetrievedContext,
  retrieveRelevantChunks,
} from "@/modules/rag/retrieve";
import {
  createIndexedSourceFromUpload,
  deleteSourceForUser,
} from "@/modules/source/service";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const hasOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim());

function makeTextFile(name: string, contents: string) {
  return new File([contents], name, { type: "text/plain" });
}

const DOC_A =
  "Quantum entanglement is a physical phenomenon where pairs of particles remain correlated. " +
  "Measuring one particle instantly affects the state of the other, even across large distances. " +
  "This document is about quantum physics and entanglement experiments.";

const DOC_B =
  "Photosynthesis converts light energy into chemical energy in plants. " +
  "Chlorophyll absorbs sunlight and helps produce glucose from carbon dioxide and water. " +
  "This document covers plant biology and photosynthesis pathways.";

describe("notebook RAG pipeline e2e", { skip: !hasDatabase || !hasOpenAI }, () => {
  let userId = "";
  let notebookId = "";

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        clerkId: `test_pipeline_${suffix}`,
        email: `pipeline-${suffix}@example.com`,
      },
    });
    userId = user.id;
    const notebook = await createNotebookForUser({
      userId,
      title: "Pipeline Audit",
    });
    notebookId = notebook.id;
  });

  after(async () => {
    if (!userId) return;
    await prisma.user.delete({ where: { id: userId } });
  });

  it("Test Case 1: create notebook → upload → INDEXED → retrieve grounded context", async () => {
    const uploadStarted = Date.now();
    const source = await createIndexedSourceFromUpload({
      userId,
      notebookId,
      file: makeTextFile("quantum.txt", DOC_A),
    });
    const uploadMs = Date.now() - uploadStarted;

    assert.equal(source.indexingStatus, "INDEXED");
    assert.equal(source.notebookId, notebookId);
    assert.ok(source.id);
    assert.ok(source.extractedText && source.extractedText.length > 0);
    assert.ok((await countSourceChunks(source.id)) > 0);
    assert.equal(await notebookHasIndexedChunks(notebookId), true);
    assert.ok(uploadMs < 60_000, `upload+index took ${uploadMs}ms`);

    const conversation = await createConversationForUser({
      userId,
      notebookId,
    });

    const retrieveStarted = Date.now();
    const chunks = await retrieveRelevantChunks({
      conversationId: conversation.id,
      notebookId,
      query: "What is this document about?",
      limit: 4,
    });
    const retrieveMs = Date.now() - retrieveStarted;

    assert.ok(chunks.length > 0, "expected retrieved chunks");
    assert.ok(
      chunks.some((chunk) => /quantum|entanglement/i.test(chunk.content)),
      "expected grounded quantum content"
    );
    assert.ok(
      chunks.every((chunk) => chunk.sourceId === source.id),
      "chunks must belong to uploaded source"
    );
    assert.ok(retrieveMs < 5_000, `retrieval took ${retrieveMs}ms`);

    const prompt = formatRetrievedContext(chunks);
    assert.match(prompt, /Retrieved notebook document context/);
    assert.match(prompt, /quantum\.txt|Quantum/i);

    const dims = await prisma.$queryRaw<Array<{ dims: number }>>`
      SELECT vector_dims(embedding)::int AS dims
      FROM "DocumentChunk"
      WHERE "sourceId" = ${source.id}
      LIMIT 1
    `;
    assert.equal(dims[0]?.dims, EMBEDDING_DIMENSIONS);

    console.log(
      JSON.stringify({
        case: 1,
        uploadMs,
        retrieveMs,
        chunkCount: chunks.length,
        scores: chunks.map((c) => Number(c.score.toFixed(4))),
      })
    );

    await deleteSourceForUser({ userId, sourceId: source.id });
  });

  it("Test Case 2: unrelated question still retrieves notebook context (or empty)", async () => {
    const source = await createIndexedSourceFromUpload({
      userId,
      notebookId,
      file: makeTextFile("quantum-2.txt", DOC_A),
    });
    const conversation = await createConversationForUser({
      userId,
      notebookId,
    });

    const chunks = await retrieveRelevantChunks({
      conversationId: conversation.id,
      notebookId,
      query: "What is the capital of France?",
      limit: 4,
    });

    // Vector search may still return nearest neighbors; prompt must remain notebook-grounded.
    const prompt = formatRetrievedContext(chunks);
    if (chunks.length > 0) {
      assert.match(prompt, /not present in the notebook sources/i);
      assert.ok(chunks.every((chunk) => chunk.sourceId === source.id));
    }

    await deleteSourceForUser({ userId, sourceId: source.id });
  });

  it("Test Case 3: delete source → retrieval returns nothing", async () => {
    const source = await createIndexedSourceFromUpload({
      userId,
      notebookId,
      file: makeTextFile("to-delete.txt", DOC_A),
    });
    const conversation = await createConversationForUser({
      userId,
      notebookId,
    });

    assert.ok((await countSourceChunks(source.id)) > 0);
    await deleteSourceForUser({ userId, sourceId: source.id });
    assert.equal(await countSourceChunks(source.id), 0);
    assert.equal(await notebookHasIndexedChunks(notebookId), false);

    const chunks = await retrieveRelevantChunks({
      conversationId: conversation.id,
      notebookId,
      query: "What is this document about?",
      limit: 4,
    });
    assert.equal(chunks.length, 0);
  });

  it("Test Case 4: multiple PDFs/sources → retrieval spans all sources", async () => {
    const sourceA = await createIndexedSourceFromUpload({
      userId,
      notebookId,
      file: makeTextFile("physics.txt", DOC_A),
    });
    const sourceB = await createIndexedSourceFromUpload({
      userId,
      notebookId,
      file: makeTextFile("biology.txt", DOC_B),
    });

    const conversation = await createConversationForUser({
      userId,
      notebookId,
    });

    const quantumChunks = await retrieveRelevantChunks({
      conversationId: conversation.id,
      notebookId,
      query: "quantum entanglement particles",
      limit: 6,
    });
    const bioChunks = await retrieveRelevantChunks({
      conversationId: conversation.id,
      notebookId,
      query: "photosynthesis chlorophyll plants",
      limit: 6,
    });

    assert.ok(quantumChunks.some((c) => c.sourceId === sourceA.id));
    assert.ok(bioChunks.some((c) => c.sourceId === sourceB.id));

    const mixed = await retrieveRelevantChunks({
      conversationId: conversation.id,
      notebookId,
      query: "energy conversion in physics and biology",
      limit: 8,
    });
    const sourceIds = new Set(
      mixed.map((c) => c.sourceId).filter((id): id is string => Boolean(id))
    );
    assert.ok(
      sourceIds.size >= 1,
      "expected retrieval across notebook sources"
    );

    await deleteSourceForUser({ userId, sourceId: sourceA.id });
    await deleteSourceForUser({ userId, sourceId: sourceB.id });
  });
});

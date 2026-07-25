import "@/modules/notebook/load-test-env";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { createNotebookForUser } from "@/modules/notebook/service";
import { countSourceChunks } from "@/modules/rag/index-source";
import {
  createSourceFromUpload,
  deleteSourceForUser,
  getSourceForUser,
  listSourcesForNotebook,
  renameSourceForUser,
} from "@/modules/source/service";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const hasOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim());

function makeTextFile(name: string, contents: string) {
  return new File([contents], name, { type: "text/plain" });
}

const LONG_NOTE =
  "Attention is all you need. Transformers use self-attention to model dependencies without recurrence. " +
  "This notebook source must be long enough for chunking and embedding in the RAG pipeline.";

describe("source service", { skip: !hasDatabase || !hasOpenAI }, () => {
  let userAId = "";
  let userBId = "";
  let notebookAId = "";
  let notebookBId = "";

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const userA = await prisma.user.create({
      data: {
        clerkId: `test_source_a_${suffix}`,
        email: `source-a-${suffix}@example.com`,
      },
    });
    const userB = await prisma.user.create({
      data: {
        clerkId: `test_source_b_${suffix}`,
        email: `source-b-${suffix}@example.com`,
      },
    });

    userAId = userA.id;
    userBId = userB.id;

    const notebookA = await createNotebookForUser({
      userId: userAId,
      title: "Sources A",
    });
    const notebookB = await createNotebookForUser({
      userId: userBId,
      title: "Sources B",
    });

    notebookAId = notebookA.id;
    notebookBId = notebookB.id;
  });

  after(async () => {
    if (!userAId && !userBId) return;
    await prisma.user.deleteMany({
      where: { id: { in: [userAId, userBId].filter(Boolean) } },
    });
  });

  it("uploads plain text, extracts, embeds, and marks INDEXED", async () => {
    const source = await createSourceFromUpload({
      userId: userAId,
      notebookId: notebookAId,
      file: makeTextFile("Transformer Notes.txt", LONG_NOTE),
    });

    assert.equal(source.type, "TEXT");
    assert.equal(source.title, "Transformer Notes");
    assert.equal(source.originalFileName, "Transformer Notes.txt");
    assert.equal(source.mimeType, "text/plain");
    assert.ok(source.fileSize > 0);
    assert.ok(source.storagePath);
    assert.notEqual(source.storagePath, "pending");
    assert.match(source.extractedText ?? "", /Attention is all you need/);
    assert.equal(source.indexingStatus, "INDEXED");
    assert.ok(source.extractedText);

    const chunkCount = await countSourceChunks(source.id);
    assert.ok(chunkCount > 0);

    const listed = await listSourcesForNotebook({
      userId: userAId,
      notebookId: notebookAId,
    });
    assert.equal(
      listed.some(
        (item) =>
          item.id === source.id &&
          item.hasExtractedText &&
          item.indexingStatus === "INDEXED"
      ),
      true
    );

    await deleteSourceForUser({ userId: userAId, sourceId: source.id });
    assert.equal(await countSourceChunks(source.id), 0);
  });

  it("uploads a text file when browser MIME type is empty", async () => {
    const file = makeTextFile("notes.txt", LONG_NOTE);
    Object.defineProperty(file, "type", { value: "" });

    const source = await createSourceFromUpload({
      userId: userAId,
      notebookId: notebookAId,
      file,
    });

    assert.equal(source.mimeType, "text/plain");
    assert.equal(source.indexingStatus, "INDEXED");
    assert.match(source.extractedText ?? "", /Attention is all you need/);

    await deleteSourceForUser({ userId: userAId, sourceId: source.id });
  });

  it("uploads a PDF, extracts text, and indexes chunks", async () => {
    // Minimal PDF with extractable text (Hello World from transformers).
    const pdfBytes = Buffer.from(
      `%PDF-1.1
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length 44 >>stream
BT /F1 24 Tf 100 100 Td (Hello) Tj ET
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000361 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
448
%%EOF`
    );

    const source = await createSourceFromUpload({
      userId: userAId,
      notebookId: notebookAId,
      file: new File([pdfBytes], "Deep Learning.pdf", {
        type: "application/pdf",
      }),
    });

    assert.equal(source.type, "PDF");
    assert.equal(source.title, "Deep Learning");
    assert.equal(source.originalFileName, "Deep Learning.pdf");
    assert.equal(source.mimeType, "application/pdf");
    assert.ok(source.storagePath);
    assert.notEqual(source.storagePath, "pending");
    assert.equal(source.indexingStatus, "INDEXED");
    assert.ok(source.extractedText);
    assert.ok((await countSourceChunks(source.id)) > 0);

    await deleteSourceForUser({ userId: userAId, sourceId: source.id });
  });

  it("rejects unsupported file types", async () => {
    const png = new File([new Uint8Array([1, 2, 3])], "x.png", {
      type: "image/png",
    });

    await assert.rejects(
      () =>
        createSourceFromUpload({
          userId: userAId,
          notebookId: notebookAId,
          file: png,
        }),
      /Unsupported file type/
    );
  });

  it("marks INDEXED after full pipeline", async () => {
    const source = await createSourceFromUpload({
      userId: userAId,
      notebookId: notebookAId,
      file: makeTextFile("status.txt", LONG_NOTE),
    });

    assert.equal(source.indexingStatus, "INDEXED");
    assert.ok(source.extractedText);

    await deleteSourceForUser({ userId: userAId, sourceId: source.id });
  });

  it("rejects empty files", async () => {
    const empty = new File([], "empty.txt", { type: "text/plain" });
    await assert.rejects(
      () =>
        createSourceFromUpload({
          userId: userAId,
          notebookId: notebookAId,
          file: empty,
        }),
      /empty/i
    );
  });

  it("renames a source", async () => {
    const source = await createSourceFromUpload({
      userId: userAId,
      notebookId: notebookAId,
      file: makeTextFile("old.txt", LONG_NOTE),
    });

    const renamed = await renameSourceForUser({
      userId: userAId,
      sourceId: source.id,
      title: "  New Title  ",
    });
    assert.equal(renamed.title, "New Title");

    await deleteSourceForUser({ userId: userAId, sourceId: source.id });
  });

  it("deletes source metadata, chunks, and extracted text", async () => {
    const source = await createSourceFromUpload({
      userId: userAId,
      notebookId: notebookAId,
      file: makeTextFile("delete-me.txt", LONG_NOTE),
    });

    assert.ok((await countSourceChunks(source.id)) > 0);

    await deleteSourceForUser({ userId: userAId, sourceId: source.id });

    const gone = await getSourceForUser({
      userId: userAId,
      sourceId: source.id,
    });
    assert.equal(gone, null);
    assert.equal(await countSourceChunks(source.id), 0);
  });

  it("enforces notebook ownership", async () => {
    await assert.rejects(
      () =>
        createSourceFromUpload({
          userId: userAId,
          notebookId: notebookBId,
          file: makeTextFile("nope.txt", LONG_NOTE),
        }),
      /Notebook not found/
    );

    const owned = await createSourceFromUpload({
      userId: userBId,
      notebookId: notebookBId,
      file: makeTextFile("b-only.txt", LONG_NOTE),
    });

    assert.equal(
      await getSourceForUser({ userId: userAId, sourceId: owned.id }),
      null
    );

    await assert.rejects(
      () =>
        deleteSourceForUser({
          userId: userAId,
          sourceId: owned.id,
        }),
      /Source not found/
    );

    await deleteSourceForUser({ userId: userBId, sourceId: owned.id });
  });
});

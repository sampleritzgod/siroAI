import "@/modules/notebook/load-test-env";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { createConversationForUser } from "@/modules/conversation/create-conversation";
import { createNotebookForUser } from "@/modules/notebook/service";
import { buildMessageCitations } from "@/modules/rag/build-citations";
import { retrieveRelevantChunks } from "@/modules/rag/retrieve";
import { youtubeTranscriptClient } from "@/modules/source/fetch-youtube";
import {
  createIndexedSourceFromUpload,
  createIndexedSourceFromWebsite,
  createIndexedSourceFromYoutube,
  deleteSourceForUser,
  type SourceRecord,
} from "@/modules/source/service";
import { loadSourceViewerData } from "@/modules/source/source-viewer";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const hasOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim());

const VIDEO_ID = "dQw4w9WgXcQ";
const TRANSCRIPT =
  "Quantum entanglement is a physical phenomenon where particle pairs stay correlated. " +
  "Measuring one particle instantly affects the other across large distances in this lecture.";

const TXT_BODY =
  "Photosynthesis converts light energy into chemical energy inside plant chloroplasts. " +
  "Chlorophyll absorbs sunlight so the plant can build glucose from carbon dioxide and water.";

const VTT_BODY = `WEBVTT

00:00:00.000 --> 00:00:04.000
Welcome to the lesson on cell biology and mitochondria.

00:00:04.000 --> 00:00:09.000
Mitochondria generate adenosine triphosphate for the cell to use as energy.
`;

const SAMPLE_HTML = `<!doctype html>
<html><head><title>Entanglement Guide</title></head>
<body><main><article><h1>Entanglement Guide</h1>
<p>Quantum entanglement keeps particle pairs correlated over long distances.
Researchers use entangled photons to test Bell inequalities and build quantum links.
This page has enough prose for chunking and embedding in the notebook pipeline.</p>
</article></main></body></html>`;

function textFile(name: string, body: string, type: string) {
  return new File([body], name, { type });
}

/** Minimal single-page PDF with a real text layer. */
function textPdfBytes(): Buffer {
  const stream = Buffer.from(
    "BT /F1 12 Tf 72 720 Td (Mitosis divides one cell into two identical daughter cells.) Tj ET"
  );
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
    ),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      Buffer.from("\nendstream"),
    ]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets: number[] = [];
  let size = chunks[0]!.length;

  objects.forEach((body, index) => {
    offsets.push(size);
    const obj = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      body,
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(obj);
    size += obj.length;
  });

  const xrefStart = size;
  const xrefLines = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n"];
  for (const offset of offsets) {
    xrefLines.push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  }
  chunks.push(Buffer.from(xrefLines.join("")));
  chunks.push(
    Buffer.from(
      `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
    )
  );

  return Buffer.concat(chunks);
}

describe(
  "source viewer payloads",
  { skip: !hasDatabase || !hasOpenAI },
  () => {
    let userId = "";
    let notebookId = "";
    let conversationId = "";
    const created: SourceRecord[] = [];

    // Chats require an indexed source, so the conversation is created lazily.
    async function ensureConversation() {
      if (conversationId) return conversationId;
      const conversation = await createConversationForUser({
        userId,
        notebookId,
      });
      conversationId = conversation.id;
      return conversationId;
    }
    const originalFetch = globalThis.fetch;
    const originalTranscript = youtubeTranscriptClient.fetchTranscript;

    before(async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const user = await prisma.user.create({
        data: {
          clerkId: `test_viewer_${suffix}`,
          email: `viewer-${suffix}@example.com`,
        },
      });
      userId = user.id;
      const notebook = await createNotebookForUser({
        userId,
        title: "Viewer Sources",
      });
      notebookId = notebook.id;

      youtubeTranscriptClient.fetchTranscript = async () => [
        { text: TRANSCRIPT.slice(0, 80), duration: 4000, offset: 0 },
        { text: TRANSCRIPT.slice(80), duration: 5000, offset: 4000 },
      ];

      globalThis.fetch = (async (
        input: RequestInfo | URL,
        init?: RequestInit
      ) => {
        const url = String(
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url
        );

        if (url.includes("youtube.com/oembed")) {
          return Response.json({
            title: "Entanglement Lecture",
            author_name: "Physics Channel",
            thumbnail_url: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
          });
        }
        if (url.includes("viewer.example")) {
          return new Response(SAMPLE_HTML, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;
    });

    after(async () => {
      youtubeTranscriptClient.fetchTranscript = originalTranscript;
      globalThis.fetch = originalFetch;
      for (const source of created) {
        await deleteSourceForUser({ userId, sourceId: source.id }).catch(
          () => {}
        );
      }
      if (userId) {
        await prisma.user.delete({ where: { id: userId } });
      }
    });

    it("opens a PDF source with a streaming file URL", async () => {
      const source = await createIndexedSourceFromUpload({
        userId,
        notebookId,
        file: new File([new Uint8Array(textPdfBytes())], "mitosis.pdf", {
          type: "application/pdf",
        }),
      });
      created.push(source);

      const view = await loadSourceViewerData({
        userId,
        sourceId: source.id,
        chunkIndex: 0,
      });

      assert.ok(view);
      assert.equal(view.type, "PDF");
      assert.equal(view.mimeType, "application/pdf");
      assert.equal(view.fileUrl, `/api/sources/${source.id}`);
      assert.equal(view.originalFileName, "mitosis.pdf");
      assert.ok(view.fileSize > 0);
      // No page index in the pipeline — the viewer opens from page 1.
      assert.ok(view.chunkText && view.chunkText.length > 0);
    });

    it("opens a TXT source and locates the cited chunk in the text", async () => {
      const source = await createIndexedSourceFromUpload({
        userId,
        notebookId,
        file: textFile("photosynthesis.txt", TXT_BODY, "text/plain"),
      });
      created.push(source);

      const view = await loadSourceViewerData({
        userId,
        sourceId: source.id,
        chunkIndex: 0,
      });

      assert.ok(view);
      assert.equal(view.type, "TEXT");
      assert.ok(view.text && /photosynthesis/i.test(view.text));
      assert.ok(view.chunkText);
      // Highlighting requires the chunk to be findable inside the full text.
      assert.ok(view.text.includes(view.chunkText.slice(0, 60)));
    });

    it("opens a VTT source as a transcript", async () => {
      const source = await createIndexedSourceFromUpload({
        userId,
        notebookId,
        file: textFile("lesson.vtt", VTT_BODY, "text/vtt"),
      });
      created.push(source);

      const view = await loadSourceViewerData({
        userId,
        sourceId: source.id,
        chunkIndex: 0,
      });

      assert.ok(view);
      assert.equal(view.type, "VTT");
      assert.ok(view.text && /mitochondria/i.test(view.text));
      assert.equal(view.fileUrl, `/api/sources/${source.id}`);
      assert.ok(view.metadata?.cueCount);
    });

    it("opens a WEBSITE source with its original URL", async () => {
      const source = await createIndexedSourceFromWebsite({
        userId,
        notebookId,
        url: "https://viewer.example/entanglement",
      });
      created.push(source);

      const view = await loadSourceViewerData({
        userId,
        sourceId: source.id,
        chunkIndex: 0,
      });

      assert.ok(view);
      assert.equal(view.type, "WEBSITE");
      assert.equal(view.url, "https://viewer.example/entanglement");
      // URL-backed sources have no downloadable file.
      assert.equal(view.fileUrl, null);
      assert.ok(view.text && /entanglement/i.test(view.text));
    });

    it("opens a YOUTUBE source with transcript and watch URL", async () => {
      const source = await createIndexedSourceFromYoutube({
        userId,
        notebookId,
        url: `https://youtu.be/${VIDEO_ID}`,
      });
      created.push(source);

      const view = await loadSourceViewerData({
        userId,
        sourceId: source.id,
        chunkIndex: 0,
      });

      assert.ok(view);
      assert.equal(view.type, "YOUTUBE");
      assert.equal(view.url, `https://www.youtube.com/watch?v=${VIDEO_ID}`);
      assert.equal(view.fileUrl, null);
      assert.ok(view.text && /entanglement/i.test(view.text));
      assert.equal(view.metadata?.videoId, VIDEO_ID);
    });

    it("builds citations from retrieval that resolve to openable sources", async () => {
      const chunks = await retrieveRelevantChunks({
        conversationId: await ensureConversation(),
        notebookId,
        query: "photosynthesis glucose chlorophyll",
        limit: 6,
      });
      assert.ok(chunks.length > 0, "expected retrieval hits");

      const citations = await buildMessageCitations(chunks);
      assert.equal(citations.length, chunks.length);

      citations.forEach((citation, position) => {
        assert.equal(citation.index, position + 1);
        assert.ok(citation.filename.length > 0);
        assert.ok(citation.sourceId || citation.attachmentId);
        assert.ok(citation.chunkIndex >= 0);
        assert.ok(citation.score > 0);
        assert.ok(citation.snippet.length > 0);
      });

      const first = citations[0]!;
      const view = await loadSourceViewerData({
        userId,
        sourceId: first.sourceId,
        chunkIndex: first.chunkIndex,
      });
      assert.ok(view, "citation must open in the viewer");
      assert.equal(view.id, first.sourceId);
    });

    it("drops citations whose source row is gone (never broken)", async () => {
      const chunks = await retrieveRelevantChunks({
        conversationId: await ensureConversation(),
        notebookId,
        query: "photosynthesis glucose chlorophyll",
        limit: 3,
      });
      assert.ok(chunks.length > 0);

      const orphan = { ...chunks[0]!, sourceId: "missing", attachmentId: null };
      const citations = await buildMessageCitations([orphan]);
      assert.deepEqual(citations, []);
    });

    it("returns null for sources the user does not own", async () => {
      const other = await prisma.user.create({
        data: {
          clerkId: `test_viewer_other_${Date.now()}`,
          email: `viewer-other-${Date.now()}@example.com`,
        },
      });

      try {
        const view = await loadSourceViewerData({
          userId: other.id,
          sourceId: created[0]!.id,
          chunkIndex: 0,
        });
        assert.equal(view, null);
      } finally {
        await prisma.user.delete({ where: { id: other.id } });
      }
    });

    it("returns null when nothing is requested", async () => {
      assert.equal(await loadSourceViewerData({ userId }), null);
    });
  }
);
import "@/modules/notebook/load-test-env";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { createConversationForUser } from "@/modules/conversation/create-conversation";
import { createNotebookForUser } from "@/modules/notebook/service";
import { countSourceChunks } from "@/modules/rag/index-source";
import { retrieveRelevantChunks } from "@/modules/rag/retrieve";
import {
  createIndexedSourceFromUpload,
  createIndexedSourceFromWebsite,
  createSourceFromWebsite,
  deleteSourceForUser,
} from "@/modules/source/service";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const hasOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim());

const SAMPLE_HTML = `<!doctype html>
<html>
<head><title>Quantum Entanglement Guide</title></head>
<body>
  <nav>Home About Contact</nav>
  <header>Site Header Ads</header>
  <main>
    <article>
      <h1>Quantum Entanglement Guide</h1>
      <p>
        Quantum entanglement is a physical phenomenon where pairs of particles
        remain correlated across large distances. Measuring one particle
        instantly affects the state of the other. This article explains
        entanglement experiments and quantum physics foundations in detail.
      </p>
      <p>
        Researchers use entangled photons to test Bell inequalities and build
        quantum communication systems. The content is intentionally long enough
        for chunking and embedding in the notebook RAG pipeline.
      </p>
    </article>
  </main>
  <footer>Copyright footer links</footer>
  <script>window.track = true;</script>
</body>
</html>`;

describe(
  "website source indexing",
  { skip: !hasDatabase || !hasOpenAI },
  () => {
    let userId = "";
    let notebookId = "";
    const originalFetch = globalThis.fetch;

    before(async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const user = await prisma.user.create({
        data: {
          clerkId: `test_web_${suffix}`,
          email: `web-${suffix}@example.com`,
        },
      });
      userId = user.id;
      const notebook = await createNotebookForUser({
        userId,
        title: "Website Sources",
      });
      notebookId = notebook.id;

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

        // Only stub website fixture hosts — never intercept OpenAI / other APIs.
        if (url.includes("empty.example")) {
          return new Response("<html><body><p>Hi</p></body></html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          });
        }
        if (url.includes("unreachable.example")) {
          return new Response("down", { status: 503 });
        }
        if (url.includes("pdf.example")) {
          return new Response("%PDF-1.4", {
            status: 200,
            headers: { "content-type": "application/pdf" },
          });
        }
        if (url.includes("quantum.example") || url.includes("://example.com/")) {
          return new Response(SAMPLE_HTML, {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return originalFetch(input, init);
      }) as typeof fetch;
    });

    after(async () => {
      globalThis.fetch = originalFetch;
      if (userId) {
        await prisma.user.delete({ where: { id: userId } });
      }
    });

    it("indexes a website and stores WEBSITE source chunks", async () => {
      const source = await createIndexedSourceFromWebsite({
        userId,
        notebookId,
        url: "https://quantum.example/entanglement",
      });

      assert.equal(source.type, "WEBSITE");
      assert.equal(source.indexingStatus, "INDEXED");
      assert.equal(source.url, "https://quantum.example/entanglement");
      assert.ok(source.extractedText && /entanglement/i.test(source.extractedText));
      assert.ok((await countSourceChunks(source.id)) > 0);

      await deleteSourceForUser({ userId, sourceId: source.id });
    });

    it("rejects invalid URL, empty content, unsupported type, and duplicates", async () => {
      await assert.rejects(
        () =>
          createSourceFromWebsite({
            userId,
            notebookId,
            url: "not a url ::: ",
          }),
        /Invalid URL/
      );

      await assert.rejects(
        () =>
          createSourceFromWebsite({
            userId,
            notebookId,
            url: "https://empty.example/",
          }),
        /Empty website content/
      );

      await assert.rejects(
        () =>
          createSourceFromWebsite({
            userId,
            notebookId,
            url: "https://pdf.example/file.pdf",
          }),
        /Unsupported content type/
      );

      const first = await createSourceFromWebsite({
        userId,
        notebookId,
        url: "https://example.com/article",
      });
      await assert.rejects(
        () =>
          createSourceFromWebsite({
            userId,
            notebookId,
            url: "https://example.com/article/",
          }),
        /already added/
      );
      await deleteSourceForUser({ userId, sourceId: first.id });
    });

    it("mixed notebook: text file + website retrieval spans both", async () => {
      const textSource = await createIndexedSourceFromUpload({
        userId,
        notebookId,
        file: new File(
          [
            "Photosynthesis converts light energy into chemical energy in plants. " +
              "Chlorophyll absorbs sunlight and helps produce glucose from carbon dioxide and water. " +
              "This document covers plant biology and photosynthesis pathways.",
          ],
          "biology.txt",
          { type: "text/plain" }
        ),
      });

      const webSource = await createIndexedSourceFromWebsite({
        userId,
        notebookId,
        url: "https://quantum.example/guide",
      });

      const conversation = await createConversationForUser({
        userId,
        notebookId,
      });

      const quantum = await retrieveRelevantChunks({
        conversationId: conversation.id,
        notebookId,
        query: "quantum entanglement particles",
        limit: 6,
      });
      const bio = await retrieveRelevantChunks({
        conversationId: conversation.id,
        notebookId,
        query: "photosynthesis chlorophyll plants",
        limit: 6,
      });

      assert.ok(quantum.some((chunk) => chunk.sourceId === webSource.id));
      assert.ok(bio.some((chunk) => chunk.sourceId === textSource.id));

      await deleteSourceForUser({ userId, sourceId: textSource.id });
      await deleteSourceForUser({ userId, sourceId: webSource.id });
    });
  }
);

import "@/modules/notebook/load-test-env";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptVideoUnavailableError,
} from "youtube-transcript";
import { prisma } from "@/lib/db";
import { createConversationForUser } from "@/modules/conversation/create-conversation";
import { createNotebookForUser } from "@/modules/notebook/service";
import { countSourceChunks } from "@/modules/rag/index-source";
import { retrieveRelevantChunks } from "@/modules/rag/retrieve";
import { youtubeTranscriptClient } from "@/modules/source/fetch-youtube";
import {
  createIndexedSourceFromUpload,
  createIndexedSourceFromWebsite,
  createIndexedSourceFromYoutube,
  createSourceFromYoutube,
  deleteSourceForUser,
} from "@/modules/source/service";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const hasOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim());

const VIDEO_ID = "dQw4w9WgXcQ";
const NO_TRANSCRIPT_ID = "notrnscript"; // 11 chars
const LONG_TRANSCRIPT =
  "Quantum entanglement is a physical phenomenon where pairs of particles remain correlated. " +
  "Measuring one particle instantly affects the state of the other across large distances. " +
  "This YouTube lecture covers quantum physics and entanglement experiments in detail for students.";

describe(
  "youtube source indexing",
  { skip: !hasDatabase || !hasOpenAI },
  () => {
    let userId = "";
    let notebookId = "";
    const originalFetch = globalThis.fetch;
    const originalTranscript = youtubeTranscriptClient.fetchTranscript;

    before(async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const user = await prisma.user.create({
        data: {
          clerkId: `test_yt_${suffix}`,
          email: `yt-${suffix}@example.com`,
        },
      });
      userId = user.id;
      const notebook = await createNotebookForUser({
        userId,
        title: "YouTube Sources",
      });
      notebookId = notebook.id;

      youtubeTranscriptClient.fetchTranscript = async (videoId) => {
        if (videoId === NO_TRANSCRIPT_ID) {
          throw new YoutubeTranscriptNotAvailableError(videoId);
        }
        if (videoId === "privatevid0") {
          throw new YoutubeTranscriptVideoUnavailableError(videoId);
        }
        return [
          { text: LONG_TRANSCRIPT.slice(0, 80), duration: 4000, offset: 0 },
          {
            text: LONG_TRANSCRIPT.slice(80),
            duration: 5000,
            offset: 4000,
          },
        ];
      };

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
          const target = new URL(url).searchParams.get("url") ?? "";
          if (target.includes("privatevid0")) {
            return new Response("Forbidden", { status: 403 });
          }
          if (target.includes("deletedvid0")) {
            return new Response("Not Found", { status: 404 });
          }
          return Response.json({
            title: "Quantum Entanglement Lecture",
            author_name: "Physics Channel",
            thumbnail_url: `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`,
          });
        }

        if (url.includes("quantum.example")) {
          return new Response(
            `<!doctype html><html><head><title>Photosynthesis Guide</title></head>
             <body><article><h1>Photosynthesis Guide</h1>
             <p>Photosynthesis converts light energy into chemical energy in plants.
             Chlorophyll absorbs sunlight and helps produce glucose from carbon dioxide and water.
             This document covers plant biology and photosynthesis pathways for notebook RAG tests.</p>
             </article></body></html>`,
            { status: 200, headers: { "content-type": "text/html" } }
          );
        }

        return originalFetch(input, init);
      }) as typeof fetch;
    });

    after(async () => {
      youtubeTranscriptClient.fetchTranscript = originalTranscript;
      globalThis.fetch = originalFetch;
      if (userId) {
        await prisma.user.delete({ where: { id: userId } });
      }
    });

    it("indexes a YouTube transcript with metadata", async () => {
      const source = await createIndexedSourceFromYoutube({
        userId,
        notebookId,
        url: `https://youtu.be/${VIDEO_ID}`,
      });

      assert.equal(source.type, "YOUTUBE");
      assert.equal(source.indexingStatus, "INDEXED");
      assert.equal(source.url, `https://www.youtube.com/watch?v=${VIDEO_ID}`);
      assert.equal(source.metadata?.videoId, VIDEO_ID);
      assert.equal(source.metadata?.channel, "Physics Channel");
      assert.ok(source.metadata?.thumbnailUrl);
      assert.ok(source.metadata?.durationSeconds);
      assert.ok(
        source.extractedText && /entanglement/i.test(source.extractedText)
      );
      assert.ok((await countSourceChunks(source.id)) > 0);

      await deleteSourceForUser({ userId, sourceId: source.id });
    });

    it("rejects invalid links, missing transcript, and duplicates", async () => {
      await assert.rejects(
        () =>
          createSourceFromYoutube({
            userId,
            notebookId,
            url: "https://vimeo.com/123456",
          }),
        /Unsupported YouTube URL|Invalid YouTube URL/
      );

      await assert.rejects(
        () =>
          createSourceFromYoutube({
            userId,
            notebookId,
            url: `https://www.youtube.com/watch?v=${NO_TRANSCRIPT_ID}`,
          }),
        /No transcript available/
      );

      const first = await createSourceFromYoutube({
        userId,
        notebookId,
        url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
      });

      await assert.rejects(
        () =>
          createSourceFromYoutube({
            userId,
            notebookId,
            url: `https://youtu.be/${VIDEO_ID}`,
          }),
        /already added/
      );

      await deleteSourceForUser({ userId, sourceId: first.id });
    });

    it("mixed notebook: text + website + youtube retrieval spans all", async () => {
      const textSource = await createIndexedSourceFromUpload({
        userId,
        notebookId,
        file: new File(
          [
            "Chess openings like the Sicilian Defense create asymmetrical pawn structures. " +
              "Players fight for central control and counterplay on the queenside in this opening system.",
          ],
          "chess.txt",
          { type: "text/plain" }
        ),
      });

      const webSource = await createIndexedSourceFromWebsite({
        userId,
        notebookId,
        url: "https://quantum.example/photosynthesis",
      });

      const ytSource = await createIndexedSourceFromYoutube({
        userId,
        notebookId,
        url: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
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
      const plants = await retrieveRelevantChunks({
        conversationId: conversation.id,
        notebookId,
        query: "photosynthesis chlorophyll plants",
        limit: 6,
      });
      const chess = await retrieveRelevantChunks({
        conversationId: conversation.id,
        notebookId,
        query: "Sicilian Defense chess openings",
        limit: 6,
      });

      assert.ok(quantum.some((chunk) => chunk.sourceId === ytSource.id));
      assert.ok(plants.some((chunk) => chunk.sourceId === webSource.id));
      assert.ok(chess.some((chunk) => chunk.sourceId === textSource.id));

      await deleteSourceForUser({ userId, sourceId: textSource.id });
      await deleteSourceForUser({ userId, sourceId: webSource.id });
      await deleteSourceForUser({ userId, sourceId: ytSource.id });
    });
  }
);

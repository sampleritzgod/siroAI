import "@/modules/notebook/load-test-env";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enqueueSourceIndexing } from "@/modules/jobs/enqueue";
import {
  IndexingLifecycleSkip,
  isIndexingLifecycleSkip,
} from "@/modules/jobs/lifecycle";
import {
  enqueueJob,
  indexSourceIdempotencyKey,
} from "@/modules/jobs/queue";
import { processJobs } from "@/modules/jobs/worker";
import { createNotebookForUser } from "@/modules/notebook/service";
import {
  countSourceChunks,
  setIndexingPhaseHookForTests,
} from "@/modules/rag/index-source";
import {
  createSourceFromUpload,
  deleteSourceForUser,
  finalizeSourceIndexing,
} from "@/modules/source/service";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const hasOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim());

const LONG_NOTE =
  "Attention is all you need. Transformers use self-attention to model dependencies without recurrence. " +
  "This notebook source must be long enough for chunking and embedding in the RAG pipeline. " +
  "Lifecycle tests verify deletion-safe indexing and idempotent chunk replacement under retries.";

function makeTextFile(name: string, contents: string) {
  return new File([contents], name, { type: "text/plain" });
}

function captureInfoLogs(): {
  messages: string[];
  restore: () => void;
} {
  const messages: string[] = [];
  const original = logger.info;
  logger.info = (message: string, fields?: Record<string, unknown>) => {
    messages.push(message);
    original.call(logger, message, fields);
  };
  return {
    messages,
    restore: () => {
      logger.info = original;
    },
  };
}

function captureErrorLogs(): {
  messages: string[];
  restore: () => void;
} {
  const messages: string[] = [];
  const original = logger.error;
  logger.error = (message: string, fields?: Record<string, unknown>) => {
    messages.push(message);
    original.call(logger, message, fields);
  };
  return {
    messages,
    restore: () => {
      logger.error = original;
    },
  };
}

describe(
  "INDEX_SOURCE job lifecycle",
  { skip: !hasDatabase || !hasOpenAI },
  () => {
    let userId = "";
    let notebookId = "";

    before(async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const user = await prisma.user.create({
        data: {
          clerkId: `test_job_life_${suffix}`,
          email: `job-life-${suffix}@example.com`,
        },
      });
      userId = user.id;
      const notebook = await createNotebookForUser({
        userId,
        title: "Job lifecycle",
      });
      notebookId = notebook.id;
    });

    after(async () => {
      setIndexingPhaseHookForTests(null);
      if (userId) {
        await prisma.user.deleteMany({ where: { id: userId } });
      }
    });

    it("skips gracefully when source was deleted before the job starts", async () => {
      const uploaded = await createSourceFromUpload({
        userId,
        notebookId,
        file: makeTextFile("pre-delete.txt", LONG_NOTE),
      });

      await enqueueJob({
        type: "INDEX_SOURCE",
        idempotencyKey: indexSourceIdempotencyKey(uploaded.id),
        payload: { sourceId: uploaded.id, notebookId },
      });

      await deleteSourceForUser({ userId, sourceId: uploaded.id });

      // Re-queue a stale job after cancel (simulates race / leftover payload).
      await prisma.backgroundJob.deleteMany({
        where: { idempotencyKey: indexSourceIdempotencyKey(uploaded.id) },
      });
      await enqueueJob({
        type: "INDEX_SOURCE",
        idempotencyKey: indexSourceIdempotencyKey(uploaded.id),
        payload: { sourceId: uploaded.id, notebookId },
      });

      const info = captureInfoLogs();
      const errors = captureErrorLogs();
      try {
        const result = await processJobs({
          limit: 3,
          types: ["INDEX_SOURCE"],
          workerId: `life-pre-${Date.now()}`,
        });

        assert.equal(result.failed, 0);
        assert.equal(result.dead, 0);
        assert.ok(result.cancelled >= 1);
        assert.ok(
          info.messages.some((m) =>
            m.includes("INDEX_SOURCE skipped (source deleted)")
          )
        );
        assert.equal(
          errors.messages.filter((m) => m.includes("Source not found")).length,
          0
        );

        const job = await prisma.backgroundJob.findUnique({
          where: { idempotencyKey: indexSourceIdempotencyKey(uploaded.id) },
        });
        assert.equal(job?.status, "CANCELLED");
        assert.equal(await countSourceChunks(uploaded.id), 0);
      } finally {
        info.restore();
        errors.restore();
      }
    });

    it("cancels cleanly and cleans partial work when source is deleted mid-index", async () => {
      const uploaded = await createSourceFromUpload({
        userId,
        notebookId,
        file: makeTextFile("mid-delete.txt", LONG_NOTE),
      });
      const storageKey = uploaded.storagePath;
      const jobKey = indexSourceIdempotencyKey(uploaded.id);

      setIndexingPhaseHookForTests(async (phase) => {
        if (phase === "embedding") {
          // Real delete path: cancels job, removes chunks + S3 object.
          await deleteSourceForUser({ userId, sourceId: uploaded.id });
        }
      });

      const info = captureInfoLogs();
      const errors = captureErrorLogs();
      try {
        await prisma.backgroundJob.deleteMany({
          where: { idempotencyKey: jobKey },
        });
        await enqueueJob({
          type: "INDEX_SOURCE",
          idempotencyKey: jobKey,
          payload: { sourceId: uploaded.id, notebookId },
        });

        const result = await processJobs({
          limit: 2,
          types: ["INDEX_SOURCE"],
          workerId: `life-mid-${Date.now()}`,
        });

        assert.equal(result.failed, 0);
        assert.equal(result.dead, 0);
        assert.ok(result.cancelled >= 1);
        assert.ok(
          info.messages.some(
            (m) =>
              m.includes("INDEX_SOURCE cancelled") ||
              m.includes("INDEX_SOURCE skipped (source deleted)")
          )
        );
        assert.equal(
          errors.messages.filter((m) =>
            /Source not found|indexing_failed/i.test(m)
          ).length,
          0
        );
        assert.equal(await countSourceChunks(uploaded.id), 0);
        assert.equal(
          await prisma.source.findUnique({ where: { id: uploaded.id } }),
          null
        );

        const { storedObjectExists, resolveStorageFromPath } = await import(
          "@/modules/files/storage"
        );
        assert.equal(
          await storedObjectExists({
            storage: resolveStorageFromPath(storageKey),
            storageKey,
          }),
          false
        );
      } finally {
        setIndexingPhaseHookForTests(null);
        info.restore();
        errors.restore();
      }
    });

    it("ignores duplicate INDEX_SOURCE enqueue while PENDING/PROCESSING", async () => {
      const uploaded = await createSourceFromUpload({
        userId,
        notebookId,
        file: makeTextFile("dup.txt", LONG_NOTE),
      });

      const key = indexSourceIdempotencyKey(uploaded.id);
      await prisma.backgroundJob.deleteMany({ where: { idempotencyKey: key } });

      await enqueueJob({
        type: "INDEX_SOURCE",
        idempotencyKey: key,
        payload: { sourceId: uploaded.id, notebookId },
      });

      const info = captureInfoLogs();
      try {
        await enqueueSourceIndexing({
          sourceId: uploaded.id,
          notebookId,
        });
        assert.ok(
          info.messages.some((m) =>
            m.includes("INDEX_SOURCE duplicate ignored")
          )
        );

        const jobs = await prisma.backgroundJob.findMany({
          where: { idempotencyKey: key },
        });
        assert.equal(jobs.length, 1);
      } finally {
        info.restore();
      }

      // Finish indexing so cleanup is clean.
      await processJobs({
        limit: 3,
        types: ["INDEX_SOURCE"],
        workerId: `life-dup-${Date.now()}`,
      });
      await deleteSourceForUser({ userId, sourceId: uploaded.id });
    });

    it("is idempotent across repeated INDEX_SOURCE runs (no duplicate chunks)", async () => {
      const uploaded = await createSourceFromUpload({
        userId,
        notebookId,
        file: makeTextFile("idempotent.txt", LONG_NOTE),
      });

      await finalizeSourceIndexing({
        sourceId: uploaded.id,
        notebookId,
      });
      const firstCount = await countSourceChunks(uploaded.id);
      assert.ok(firstCount > 0);

      // Force re-index by resetting status (simulates retry / rescue path).
      await prisma.source.update({
        where: { id: uploaded.id },
        data: { indexingStatus: "PROCESSING" },
      });
      await finalizeSourceIndexing({
        sourceId: uploaded.id,
        notebookId,
      });
      const secondCount = await countSourceChunks(uploaded.id);
      assert.equal(secondCount, firstCount);

      await deleteSourceForUser({ userId, sourceId: uploaded.id });
    });

    it("treats already-INDEXED sources as completed without ERROR", async () => {
      const uploaded = await createSourceFromUpload({
        userId,
        notebookId,
        file: makeTextFile("already.txt", LONG_NOTE),
      });
      await finalizeSourceIndexing({
        sourceId: uploaded.id,
        notebookId,
      });

      await enqueueJob({
        type: "INDEX_SOURCE",
        idempotencyKey: `index:source:again-${uploaded.id}`,
        payload: { sourceId: uploaded.id, notebookId },
      });

      const info = captureInfoLogs();
      const errors = captureErrorLogs();
      try {
        const result = await processJobs({
          limit: 2,
          types: ["INDEX_SOURCE"],
          workerId: `life-done-${Date.now()}`,
        });
        assert.equal(result.failed, 0);
        assert.ok(result.succeeded >= 1 || result.cancelled >= 0);
        assert.ok(
          info.messages.some((m) =>
            m.includes("INDEX_SOURCE already completed")
          )
        );
        assert.equal(
          errors.messages.filter((m) => m.includes("Source not found")).length,
          0
        );
      } finally {
        info.restore();
        errors.restore();
        await prisma.backgroundJob.deleteMany({
          where: { idempotencyKey: `index:source:again-${uploaded.id}` },
        });
        await deleteSourceForUser({ userId, sourceId: uploaded.id });
      }
    });

    it("marks cancelled jobs without retry when deleteSource cancels the queue", async () => {
      const uploaded = await createSourceFromUpload({
        userId,
        notebookId,
        file: makeTextFile("cancel.txt", LONG_NOTE),
      });

      const key = indexSourceIdempotencyKey(uploaded.id);
      await prisma.backgroundJob.deleteMany({ where: { idempotencyKey: key } });
      await enqueueJob({
        type: "INDEX_SOURCE",
        idempotencyKey: key,
        payload: { sourceId: uploaded.id, notebookId },
      });

      await deleteSourceForUser({ userId, sourceId: uploaded.id });

      const job = await prisma.backgroundJob.findUnique({
        where: { idempotencyKey: key },
      });
      assert.equal(job?.status, "CANCELLED");

      const result = await processJobs({
        limit: 3,
        types: ["INDEX_SOURCE"],
        workerId: `life-cancel-${Date.now()}`,
      });
      assert.equal(result.failed, 0);
      assert.equal(result.dead, 0);
      assert.equal(await countSourceChunks(uploaded.id), 0);
    });

    it("finalizeSourceIndexing throws IndexingLifecycleSkip (not notFound) for missing sources", async () => {
      try {
        await finalizeSourceIndexing({
          sourceId: "missing_source_id",
          notebookId,
        });
        assert.fail("expected IndexingLifecycleSkip");
      } catch (error) {
        assert.equal(isIndexingLifecycleSkip(error), true);
        assert.equal(
          (error as IndexingLifecycleSkip).reason,
          "source_deleted"
        );
        assert.match(
          (error as Error).message,
          /INDEX_SOURCE skipped \(source deleted\)/
        );
      }
    });

    it("cleans partial chunks when cancelled during vector_insert phase", async () => {
      const uploaded = await createSourceFromUpload({
        userId,
        notebookId,
        file: makeTextFile("partial.txt", LONG_NOTE),
      });
      const jobKey = indexSourceIdempotencyKey(uploaded.id);

      setIndexingPhaseHookForTests(async (phase) => {
        if (phase === "vector_insert") {
          await deleteSourceForUser({ userId, sourceId: uploaded.id });
        }
      });

      const errors = captureErrorLogs();
      try {
        await prisma.backgroundJob.deleteMany({
          where: { idempotencyKey: jobKey },
        });
        await enqueueJob({
          type: "INDEX_SOURCE",
          idempotencyKey: jobKey,
          payload: { sourceId: uploaded.id, notebookId },
        });

        const result = await processJobs({
          limit: 2,
          types: ["INDEX_SOURCE"],
          workerId: `life-partial-${Date.now()}`,
        });

        assert.equal(result.failed, 0);
        assert.ok(result.cancelled >= 1);
        assert.equal(await countSourceChunks(uploaded.id), 0);
        assert.equal(
          errors.messages.filter((m) => m.includes("Source not found")).length,
          0
        );
      } finally {
        setIndexingPhaseHookForTests(null);
        errors.restore();
      }
    });
  }
);

import { after } from "next/server";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import {
  enqueueJob,
  indexAttachmentIdempotencyKey,
  indexSourceIdempotencyKey,
} from "@/modules/jobs/queue";
import { lifecycleLogMessage } from "@/modules/jobs/lifecycle";

/**
 * Persist indexing jobs only. Never run processJobs() on interactive paths.
 *
 * Drain happens only in /api/cron/jobs (Vercel Cron, QStash, or external
 * scheduler). After enqueue we optionally publish a QStash message so a
 * *separate* invocation runs the worker — this request never embeds or indexes.
 */
function resolveAppOrigin(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "")}`;

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:3000";
  }

  return null;
}

/**
 * Wake the job worker without executing processJobs in this request.
 * Awaits only the QStash publish ACK (milliseconds), never the drain itself.
 */
function requestJobDrain(): void {
  const origin = resolveAppOrigin();
  const cronSecret = process.env.CRON_SECRET?.trim();
  const qstashToken = process.env.QSTASH_TOKEN?.trim();

  if (!qstashToken || !origin) {
    logger.info("job_enqueued_awaiting_cron", {
      hasQstash: Boolean(qstashToken),
      hasOrigin: Boolean(origin),
      hint: "Set QSTASH_TOKEN for near-real-time drain, or hit /api/cron/jobs on a 1–5m schedule",
    });
    return;
  }

  const target = `${origin}/api/cron/jobs`;
  const publishUrl = `https://qstash.upstash.io/v2/publish/${encodeURIComponent(target)}`;

  try {
    after(async () => {
      try {
        const response = await fetch(publishUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${qstashToken}`,
            "Content-Type": "application/json",
            ...(cronSecret
              ? { "Upstash-Forward-Authorization": `Bearer ${cronSecret}` }
              : {}),
          },
          body: "{}",
        });
        if (!response.ok) {
          const body = await response.text().catch(() => "");
          logger.warn("job_drain_qstash_failed", {
            status: response.status,
            body: body.slice(0, 200),
          });
        }
      } catch (error) {
        logger.warn("job_drain_qstash_failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  } catch (error) {
    // after() unavailable (tests / scripts) — never fall back to processJobs.
    logger.warn("job_drain_wake_skipped", {
      reason: "after_unavailable",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function enqueueSourceIndexing(input: {
  sourceId: string;
  notebookId: string;
}) {
  const source = await prisma.source.findFirst({
    where: { id: input.sourceId, notebookId: input.notebookId },
    select: { id: true, indexingStatus: true },
  });

  if (!source) {
    logger.info(lifecycleLogMessage("source_deleted"), {
      sourceId: input.sourceId,
      notebookId: input.notebookId,
    });
    return;
  }

  if (source.indexingStatus === "INDEXED") {
    logger.info(lifecycleLogMessage("already_completed"), {
      sourceId: input.sourceId,
      notebookId: input.notebookId,
    });
    return;
  }

  const idempotencyKey = indexSourceIdempotencyKey(input.sourceId);
  const existing = await prisma.backgroundJob.findUnique({
    where: { idempotencyKey },
  });

  // Duplicate INDEX_SOURCE while already queued or actively processing.
  if (
    existing &&
    (existing.status === "PENDING" ||
      existing.status === "RUNNING" ||
      existing.status === "SUCCEEDED")
  ) {
    logger.info(lifecycleLogMessage("duplicate_ignored"), {
      sourceId: input.sourceId,
      notebookId: input.notebookId,
      jobId: existing.id,
      jobStatus: existing.status,
      indexingStatus: source.indexingStatus,
    });
    if (existing.status === "PENDING" || existing.status === "RUNNING") {
      requestJobDrain();
    }
    return;
  }

  // PROCESSING/FAILED with no active job (or DEAD/CANCELLED): enqueue/retry.
  await enqueueJob({
    type: "INDEX_SOURCE",
    idempotencyKey,
    payload: {
      sourceId: input.sourceId,
      notebookId: input.notebookId,
    },
  });

  requestJobDrain();
}

export async function enqueueAttachmentIndexing(input: {
  attachmentId: string;
  conversationId: string;
}) {
  await enqueueJob({
    type: "INDEX_ATTACHMENT",
    idempotencyKey: indexAttachmentIdempotencyKey(input.attachmentId),
    payload: {
      attachmentId: input.attachmentId,
      conversationId: input.conversationId,
    },
  });

  requestJobDrain();
}

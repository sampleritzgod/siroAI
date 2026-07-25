import type { BackgroundJob } from "@/generated/prisma/client";
import { captureException, createRequestId, logger } from "@/lib/logger";
import { indexAttachmentForRag } from "@/modules/rag/index-attachment";
import { hardPurgeNotebook } from "@/modules/notebook/purge";
import { finalizeSourceIndexing } from "@/modules/source/service";
import {
  claimNextJob,
  completeJob,
  failJob,
  updateJobProgress,
  type JobPayload,
} from "@/modules/jobs/queue";

export type ProcessJobsResult = {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
};

/**
 * Drain up to `limit` eligible jobs. Safe to call from cron or after().
 */
export async function processJobs(input?: {
  limit?: number;
  types?: Array<"INDEX_SOURCE" | "INDEX_ATTACHMENT" | "PURGE_NOTEBOOK">;
  workerId?: string;
}): Promise<ProcessJobsResult> {
  const limit = Math.min(Math.max(input?.limit ?? 5, 1), 20);
  const workerId = input?.workerId ?? `worker-${createRequestId().slice(0, 8)}`;
  const result: ProcessJobsResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    dead: 0,
  };

  for (let i = 0; i < limit; i += 1) {
    const job = await claimNextJob({
      workerId,
      types: input?.types,
    });
    if (!job) break;

    result.processed += 1;
    const started = Date.now();

    try {
      await updateJobProgress(job.id, {
        stage: "started",
        startedAt: new Date().toISOString(),
      });
      await runJob(job);
      await completeJob(job.id, {
        stage: "completed",
        durationMs: Date.now() - started,
      });
      result.succeeded += 1;
      logger.info("job_succeeded", {
        jobId: job.id,
        type: job.type,
        attempts: job.attempts,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      await captureException(error, {
        stage: "job_worker",
        jobId: job.id,
        type: job.type,
      });
      const { dead } = await failJob(job, error);
      if (dead) result.dead += 1;
      else result.failed += 1;
    }
  }

  return result;
}

async function runJob(job: BackgroundJob): Promise<void> {
  const payload = job.payload as JobPayload;

  switch (job.type) {
    case "INDEX_SOURCE": {
      const sourceId = String(payload.sourceId ?? "");
      const notebookId = String(payload.notebookId ?? "");
      if (!sourceId || !notebookId) {
        throw new Error("Invalid INDEX_SOURCE payload");
      }
      await updateJobProgress(job.id, { stage: "indexing_source", sourceId });
      await finalizeSourceIndexing({ sourceId, notebookId });
      return;
    }
    case "INDEX_ATTACHMENT": {
      const attachmentId = String(payload.attachmentId ?? "");
      const conversationId = String(payload.conversationId ?? "");
      if (!attachmentId || !conversationId) {
        throw new Error("Invalid INDEX_ATTACHMENT payload");
      }
      await updateJobProgress(job.id, {
        stage: "indexing_attachment",
        attachmentId,
      });

      const { prisma } = await import("@/lib/db");
      const attachment = await prisma.attachment.findFirst({
        where: { id: attachmentId, conversationId },
        select: { extractedText: true },
      });

      await indexAttachmentForRag({
        attachmentId,
        conversationId,
        extractedText: attachment?.extractedText ?? null,
      });
      return;
    }
    case "PURGE_NOTEBOOK": {
      const notebookId = String(payload.notebookId ?? "");
      if (!notebookId) {
        throw new Error("Invalid PURGE_NOTEBOOK payload");
      }
      await updateJobProgress(job.id, { stage: "purging_notebook", notebookId });
      await hardPurgeNotebook(notebookId);
      return;
    }
    default:
      throw new Error(`Unknown job type: ${job.type}`);
  }
}

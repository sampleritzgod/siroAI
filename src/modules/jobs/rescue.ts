import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enqueueJob } from "@/modules/jobs/queue";

/** Max times a DEAD index job may be re-queued before permanent failure. */
export const MAX_DEAD_RESCUES = 3;
/** Stop rescuing jobs whose first failure (createdAt) is older than this. */
export const MAX_DEAD_AGE_MS = 24 * 60 * 60 * 1000;

type JobPayload = Record<string, unknown> & {
  rescueCount?: number;
  permanentlyFailed?: boolean;
};

/**
 * Re-queue DEAD index jobs when the underlying source/attachment still needs work.
 * Caps rescue attempts and age so permanently broken sources stop looping.
 */
export async function rescueDeadIndexJobs(): Promise<{
  rescued: number;
  permanentlyFailed: number;
}> {
  const deadJobs = await prisma.backgroundJob.findMany({
    where: {
      status: "DEAD",
      type: { in: ["INDEX_SOURCE", "INDEX_ATTACHMENT"] },
      completedAt: { lte: new Date(Date.now() - 2 * 60_000) },
    },
    take: 25,
    orderBy: { completedAt: "asc" },
  });

  let rescued = 0;
  let permanentlyFailed = 0;

  for (const job of deadJobs) {
    const payload = (job.payload ?? {}) as JobPayload;
    if (payload.permanentlyFailed) continue;

    const rescueCount = Number(payload.rescueCount ?? 0);
    const ageMs = Date.now() - job.createdAt.getTime();

    if (rescueCount >= MAX_DEAD_RESCUES || ageMs > MAX_DEAD_AGE_MS) {
      await markPermanentlyFailed(job.id, payload, {
        reason:
          rescueCount >= MAX_DEAD_RESCUES
            ? "max_rescues"
            : "max_age",
        rescueCount,
        ageMs,
      });
      permanentlyFailed += 1;
      continue;
    }

    if (job.type === "INDEX_SOURCE") {
      const sourceId = String(payload.sourceId ?? "");
      if (!sourceId) continue;
      const source = await prisma.source.findFirst({
        where: {
          id: sourceId,
          indexingStatus: { in: ["FAILED", "PENDING", "PROCESSING"] },
        },
        select: { id: true, notebookId: true },
      });
      if (!source) continue;

      await enqueueJob({
        type: "INDEX_SOURCE",
        idempotencyKey: job.idempotencyKey,
        payload: {
          sourceId: source.id,
          notebookId: source.notebookId,
          rescueCount: rescueCount + 1,
        },
        maxAttempts: job.maxAttempts,
      });
      rescued += 1;
    }

    if (job.type === "INDEX_ATTACHMENT") {
      const attachmentId = String(payload.attachmentId ?? "");
      const conversationId = String(payload.conversationId ?? "");
      if (!attachmentId || !conversationId) continue;
      const attachment = await prisma.attachment.findFirst({
        where: { id: attachmentId, status: "READY" },
        select: { id: true },
      });
      if (!attachment) continue;

      const hasChunks = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "DocumentChunk"
        WHERE "attachmentId" = ${attachmentId}
      `;
      if (Number(hasChunks[0]?.count ?? 0) > 0) continue;

      await enqueueJob({
        type: "INDEX_ATTACHMENT",
        idempotencyKey: job.idempotencyKey,
        payload: {
          attachmentId,
          conversationId,
          rescueCount: rescueCount + 1,
        },
        maxAttempts: job.maxAttempts,
      });
      rescued += 1;
    }
  }

  if (rescued > 0 || permanentlyFailed > 0) {
    logger.info("job_dead_rescued", { rescued, permanentlyFailed });
  }

  return { rescued, permanentlyFailed };
}

async function markPermanentlyFailed(
  jobId: string,
  payload: JobPayload,
  meta: { reason: string; rescueCount: number; ageMs: number }
) {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      lastError: `Permanently failed (${meta.reason}): rescues=${meta.rescueCount}, ageMs=${meta.ageMs}`,
      payload: {
        ...payload,
        permanentlyFailed: true,
        permanentlyFailedAt: new Date().toISOString(),
        permanentlyFailedReason: meta.reason,
      } as Prisma.InputJsonValue,
    },
  });

  // Keep the Source row FAILED so the UI stays honest.
  const sourceId = String(payload.sourceId ?? "");
  if (sourceId) {
    await prisma.source.updateMany({
      where: {
        id: sourceId,
        indexingStatus: { in: ["FAILED", "PENDING", "PROCESSING"] },
      },
      data: { indexingStatus: "FAILED" },
    });
  }

  logger.warn("job_permanently_failed", { jobId, ...meta });
}

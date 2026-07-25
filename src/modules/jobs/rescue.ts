import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { enqueueJob } from "@/modules/jobs/queue";

/**
 * Re-queue DEAD index jobs when the underlying source/attachment still needs work.
 * Prevents permanent loss after timeouts / transient OpenAI failures.
 */
export async function rescueDeadIndexJobs(): Promise<number> {
  const deadJobs = await prisma.backgroundJob.findMany({
    where: {
      status: "DEAD",
      type: { in: ["INDEX_SOURCE", "INDEX_ATTACHMENT"] },
      // Only rescue jobs that have been dead for at least 2 minutes.
      completedAt: { lte: new Date(Date.now() - 2 * 60_000) },
    },
    take: 25,
    orderBy: { completedAt: "asc" },
  });

  let rescued = 0;

  for (const job of deadJobs) {
    const payload = job.payload as Record<string, unknown>;

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
        payload: { attachmentId, conversationId },
        maxAttempts: job.maxAttempts,
      });
      rescued += 1;
    }
  }

  if (rescued > 0) {
    logger.info("job_dead_rescued", { rescued });
  }

  return rescued;
}

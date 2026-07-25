import type {
  BackgroundJob,
  BackgroundJobStatus,
  BackgroundJobType,
} from "@/generated/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export type JobPayload = Record<string, unknown>;

function asJson(value: JobPayload): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

const DEFAULT_MAX_ATTEMPTS = 5;
/** Stale RUNNING locks older than this are reclaimed. */
export const JOB_LOCK_TIMEOUT_MS = 5 * 60 * 1000;

export function indexSourceIdempotencyKey(sourceId: string) {
  return `index:source:${sourceId}`;
}

export function indexAttachmentIdempotencyKey(attachmentId: string) {
  return `index:attachment:${attachmentId}`;
}

export function purgeNotebookIdempotencyKey(notebookId: string) {
  return `purge:notebook:${notebookId}`;
}

/**
 * Enqueue a job. Duplicate idempotency keys are no-ops (returns existing).
 * Resets FAILED/DEAD/CANCELLED jobs back to PENDING for explicit retry.
 */
export async function enqueueJob(input: {
  type: BackgroundJobType;
  idempotencyKey: string;
  payload: JobPayload;
  maxAttempts?: number;
  runAt?: Date;
}): Promise<BackgroundJob> {
  const existing = await prisma.backgroundJob.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });

  if (existing) {
    if (
      existing.status === "PENDING" ||
      existing.status === "RUNNING" ||
      existing.status === "SUCCEEDED"
    ) {
      return existing;
    }

    // Retry path for FAILED / DEAD / CANCELLED.
    return prisma.backgroundJob.update({
      where: { id: existing.id },
      data: {
        status: "PENDING",
        payload: asJson(input.payload),
        attempts: 0,
        maxAttempts: input.maxAttempts ?? existing.maxAttempts,
        nextRunAt: input.runAt ?? new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        progress: Prisma.JsonNull,
        completedAt: null,
      },
    });
  }

  return prisma.backgroundJob.create({
    data: {
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      payload: asJson(input.payload),
      maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      nextRunAt: input.runAt ?? new Date(),
    },
  });
}

export async function cancelJobsByIdempotencyPrefix(
  prefix: string
): Promise<number> {
  const result = await prisma.backgroundJob.updateMany({
    where: {
      idempotencyKey: { startsWith: prefix },
      status: { in: ["PENDING", "FAILED", "DEAD"] },
    },
    data: {
      status: "CANCELLED",
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
  return result.count;
}

export async function cancelJobByIdempotencyKey(
  idempotencyKey: string
): Promise<void> {
  await prisma.backgroundJob.updateMany({
    where: {
      idempotencyKey,
      status: { in: ["PENDING", "FAILED", "DEAD", "RUNNING"] },
    },
    data: {
      status: "CANCELLED",
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    },
  });
}

function backoffMs(attempt: number): number {
  // 5s, 10s, 20s, 40s, 80s (capped at 5 min)
  return Math.min(5 * 60_000, 5_000 * 2 ** Math.max(0, attempt - 1));
}

/**
 * Atomically claim the next eligible job (SKIP LOCKED style via conditional update).
 */
export async function claimNextJob(input: {
  workerId: string;
  types?: BackgroundJobType[];
}): Promise<BackgroundJob | null> {
  const now = new Date();
  const lockCutoff = new Date(Date.now() - JOB_LOCK_TIMEOUT_MS);

  // Reclaim stale RUNNING locks first.
  await prisma.backgroundJob.updateMany({
    where: {
      status: "RUNNING",
      lockedAt: { lt: lockCutoff },
      ...(input.types ? { type: { in: input.types } } : {}),
    },
    data: {
      status: "PENDING",
      lockedAt: null,
      lockedBy: null,
      lastError: "Lock timed out — requeued",
    },
  });

  const candidates = await prisma.backgroundJob.findMany({
    where: {
      status: "PENDING",
      nextRunAt: { lte: now },
      ...(input.types ? { type: { in: input.types } } : {}),
    },
    orderBy: { nextRunAt: "asc" },
    take: 5,
  });

  for (const candidate of candidates) {
    const claimed = await prisma.backgroundJob.updateMany({
      where: {
        id: candidate.id,
        status: "PENDING",
      },
      data: {
        status: "RUNNING",
        lockedAt: now,
        lockedBy: input.workerId,
        attempts: { increment: 1 },
      },
    });

    if (claimed.count === 1) {
      return prisma.backgroundJob.findUniqueOrThrow({
        where: { id: candidate.id },
      });
    }
  }

  return null;
}

/**
 * Mark a RUNNING job SUCCEEDED. No-op if the job was CANCELLED mid-flight
 * (e.g. source deleted while the worker was still indexing).
 */
export async function completeJob(
  jobId: string,
  progress?: JobPayload
): Promise<boolean> {
  const result = await prisma.backgroundJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: {
      status: "SUCCEEDED",
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      ...(progress ? { progress: asJson(progress) } : {}),
    },
  });
  return result.count === 1;
}

/**
 * Terminal cancel/skip for lifecycle outcomes (deleted source, duplicate, etc.).
 * Never schedules a retry. Safe if already CANCELLED.
 */
export async function settleJobCancelled(
  jobId: string,
  reason: string,
  progress?: JobPayload
): Promise<boolean> {
  const result = await prisma.backgroundJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["RUNNING", "PENDING", "FAILED"] },
    },
    data: {
      status: "CANCELLED",
      completedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: reason.slice(0, 2000),
      ...(progress ? { progress: asJson(progress) } : {}),
    },
  });
  return result.count === 1;
}

export async function failJob(
  job: BackgroundJob,
  error: unknown
): Promise<{ dead: boolean }> {
  const message =
    error instanceof Error ? error.message.slice(0, 2000) : String(error);
  const attempts = job.attempts;
  const dead = attempts >= job.maxAttempts;

  if (dead) {
    await prisma.backgroundJob.update({
      where: { id: job.id },
      data: {
        status: "DEAD",
        lastError: message,
        completedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    });
    logger.error("job_dead_letter", {
      jobId: job.id,
      type: job.type,
      attempts,
      error: message,
    });
    return { dead: true };
  }

  const delay = backoffMs(attempts);
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: {
      status: "PENDING",
      lastError: message,
      nextRunAt: new Date(Date.now() + delay),
      lockedAt: null,
      lockedBy: null,
    },
  });

  logger.warn("job_retry_scheduled", {
    jobId: job.id,
    type: job.type,
    attempts,
    nextDelayMs: delay,
    error: message,
  });

  return { dead: false };
}

export async function updateJobProgress(
  jobId: string,
  progress: JobPayload
): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: { progress: asJson(progress) },
  });
}

export async function getJobStats(): Promise<
  Record<BackgroundJobStatus, number>
> {
  const rows = await prisma.backgroundJob.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  const stats: Record<BackgroundJobStatus, number> = {
    PENDING: 0,
    RUNNING: 0,
    SUCCEEDED: 0,
    FAILED: 0,
    DEAD: 0,
    CANCELLED: 0,
  };

  for (const row of rows) {
    stats[row.status] = row._count._all;
  }

  return stats;
}

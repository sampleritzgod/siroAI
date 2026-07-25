import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { deleteStoredUpload, resolveStorageFromPath } from "@/modules/files/storage";
import {
  WEBSITE_STORAGE_PATH,
  YOUTUBE_STORAGE_PATH,
} from "@/modules/source/constants";
import {
  enqueueJob,
  purgeNotebookIdempotencyKey,
} from "@/modules/jobs/queue";

/** Soft-deleted notebooks older than this are hard-purged. */
export const NOTEBOOK_PURGE_RETENTION_DAYS = Number(
  process.env.NOTEBOOK_PURGE_RETENTION_DAYS?.trim() || "30"
);

/**
 * Find soft-deleted notebooks past retention and enqueue durable purge jobs.
 */
export async function enqueueExpiredNotebookPurges(): Promise<{
  scanned: number;
  enqueued: number;
}> {
  const cutoff = new Date(
    Date.now() - NOTEBOOK_PURGE_RETENTION_DAYS * 24 * 60 * 60 * 1000
  );

  const expired = await prisma.notebook.findMany({
    where: {
      deletedAt: { not: null, lte: cutoff },
    },
    select: { id: true },
    take: 50,
  });

  let enqueued = 0;
  for (const notebook of expired) {
    await enqueueJob({
      type: "PURGE_NOTEBOOK",
      idempotencyKey: purgeNotebookIdempotencyKey(notebook.id),
      payload: { notebookId: notebook.id },
    });
    enqueued += 1;
  }

  return { scanned: expired.length, enqueued };
}

/**
 * Permanently delete a soft-deleted notebook: blobs → DB cascade.
 * Idempotent if already deleted or restored.
 */
export async function hardPurgeNotebook(notebookId: string): Promise<{
  blobBytesFreed: number;
  chunksDeleted: number;
}> {
  const notebook = await prisma.notebook.findFirst({
    where: { id: notebookId, deletedAt: { not: null } },
    include: {
      sources: {
        select: {
          id: true,
          type: true,
          storagePath: true,
          fileSize: true,
        },
      },
    },
  });

  if (!notebook) {
    logger.info("purge_notebook_skip", {
      notebookId,
      reason: "not_found_or_active",
    });
    return { blobBytesFreed: 0, chunksDeleted: 0 };
  }

  const conversations = await prisma.conversation.findMany({
    where: { notebookId },
    select: { id: true },
  });
  const conversationIds = conversations.map((c) => c.id);

  const attachments =
    conversationIds.length > 0
      ? await prisma.attachment.findMany({
          where: { conversationId: { in: conversationIds } },
          select: {
            id: true,
            storage: true,
            storageKey: true,
            sizeBytes: true,
          },
        })
      : [];

  let blobBytesFreed = 0;

  for (const source of notebook.sources) {
    if (
      source.type === "WEBSITE" ||
      source.type === "YOUTUBE" ||
      !source.storagePath ||
      source.storagePath === "pending" ||
      source.storagePath === WEBSITE_STORAGE_PATH ||
      source.storagePath === YOUTUBE_STORAGE_PATH
    ) {
      continue;
    }

    try {
      await deleteStoredUpload({
        objectId: source.id,
        storage: resolveStorageFromPath(source.storagePath),
        storageKey: source.storagePath,
      });
      blobBytesFreed += source.fileSize;
    } catch (error) {
      logger.warn("purge_source_blob_failed", {
        sourceId: source.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const attachment of attachments) {
    if (attachment.storageKey === "pending") continue;
    try {
      await deleteStoredUpload({
        objectId: attachment.id,
        storage: attachment.storage,
        storageKey: attachment.storageKey,
      });
      blobBytesFreed += attachment.sizeBytes;
    } catch (error) {
      logger.warn("purge_attachment_blob_failed", {
        attachmentId: attachment.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const chunkRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "DocumentChunk"
    WHERE "notebookId" = ${notebookId}
  `;
  const chunksDeleted = Number(chunkRows[0]?.count ?? 0);

  await prisma.notebook.delete({ where: { id: notebookId } });

  logger.info("purge_notebook_complete", {
    notebookId,
    blobBytesFreed,
    chunksDeleted,
    sourceCount: notebook.sources.length,
    attachmentCount: attachments.length,
  });

  return { blobBytesFreed, chunksDeleted };
}

/**
 * Storage metrics for soft-deleted notebooks still within retention.
 */
export async function getSoftDeleteStorageMetrics(): Promise<{
  softDeletedNotebooks: number;
  oldestDeletedAt: string | null;
  retentionDays: number;
}> {
  const [count, oldest] = await Promise.all([
    prisma.notebook.count({ where: { deletedAt: { not: null } } }),
    prisma.notebook.findFirst({
      where: { deletedAt: { not: null } },
      orderBy: { deletedAt: "asc" },
      select: { deletedAt: true },
    }),
  ]);

  return {
    softDeletedNotebooks: count,
    oldestDeletedAt: oldest?.deletedAt?.toISOString() ?? null,
    retentionDays: NOTEBOOK_PURGE_RETENTION_DAYS,
  };
}

import type {
  SourceIndexingStatus,
  SourceType,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { extractAttachmentContent } from "@/modules/files/extract-text";
import {
  deleteStoredUpload,
  storeUpload,
} from "@/modules/files/storage";
import {
  MAX_UPLOAD_BYTES,
  SOURCE_TITLE_MAX_LENGTH,
  defaultTitleFromFilename,
  formatSourceUploadError,
  isRemoteStoragePath,
  resolveSourceMediaType,
  sourceTypeFromMediaType,
} from "@/modules/source/constants";

export type SourceRecord = {
  id: string;
  notebookId: string;
  type: SourceType;
  title: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  extractedText: string | null;
  indexingStatus: SourceIndexingStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type SourceListItem = {
  id: string;
  notebookId: string;
  type: SourceType;
  title: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  indexingStatus: SourceIndexingStatus;
  hasExtractedText: boolean;
  createdAt: Date;
  updatedAt: Date;
};

async function assertNotebookOwner(notebookId: string, userId: string) {
  const notebook = await prisma.notebook.findFirst({
    where: { id: notebookId, userId },
    select: { id: true },
  });

  if (!notebook) {
    throw new Error("Notebook not found");
  }

  return notebook;
}

async function assertSourceOwner(sourceId: string, userId: string) {
  const source = await prisma.source.findFirst({
    where: {
      id: sourceId,
      notebook: { userId },
    },
  });

  if (!source) {
    throw new Error("Source not found");
  }

  return source;
}

export async function listSourcesForNotebook(input: {
  userId: string;
  notebookId: string;
}): Promise<SourceListItem[]> {
  await assertNotebookOwner(input.notebookId, input.userId);

  const rows = await prisma.source.findMany({
    where: { notebookId: input.notebookId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      notebookId: true,
      type: true,
      title: true,
      originalFileName: true,
      mimeType: true,
      fileSize: true,
      indexingStatus: true,
      extractedText: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    notebookId: row.notebookId,
    type: row.type,
    title: row.title,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    indexingStatus: row.indexingStatus,
    hasExtractedText: Boolean(row.extractedText),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function listSourcesForUser(userId: string): Promise<SourceListItem[]> {
  const rows = await prisma.source.findMany({
    where: { notebook: { userId } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      notebookId: true,
      type: true,
      title: true,
      originalFileName: true,
      mimeType: true,
      fileSize: true,
      indexingStatus: true,
      extractedText: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    notebookId: row.notebookId,
    type: row.type,
    title: row.title,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    indexingStatus: row.indexingStatus,
    hasExtractedText: Boolean(row.extractedText),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function getSourceForUser(input: {
  userId: string;
  sourceId: string;
}): Promise<SourceRecord | null> {
  return prisma.source.findFirst({
    where: {
      id: input.sourceId,
      notebook: { userId: input.userId },
    },
  });
}

/**
 * Upload + extract a notebook source.
 * Terminal success status is PENDING with extracted text (chat-ready).
 * Does not create embeddings.
 */
export async function createSourceFromUpload(input: {
  userId: string;
  notebookId: string;
  file: File;
}): Promise<SourceRecord> {
  logger.info("[UPLOAD] start", {
    notebookId: input.notebookId,
    filename: input.file.name,
    declaredType: input.file.type,
    size: input.file.size,
  });

  await assertNotebookOwner(input.notebookId, input.userId);

  const originalFileName = input.file.name?.trim() || "upload";
  const mediaType = resolveSourceMediaType({
    filename: originalFileName,
    fileType: input.file.type,
  });

  if (!mediaType) {
    logger.warn("[UPLOAD] rejected_mime", {
      filename: originalFileName,
      declaredType: input.file.type,
    });
    throw new Error(
      "Unsupported file type. Only PDF and plain text are allowed."
    );
  }

  if (input.file.size <= 0) {
    throw new Error("File is empty.");
  }

  if (input.file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File too large. Maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`
    );
  }

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const type = sourceTypeFromMediaType(mediaType);
  const title = defaultTitleFromFilename(originalFileName);

  logger.info("[DATABASE] create_pending", {
    notebookId: input.notebookId,
    type,
    mimeType: mediaType,
    fileSize: bytes.length,
  });

  let pending;
  try {
    pending = await prisma.source.create({
      data: {
        notebookId: input.notebookId,
        type,
        title,
        originalFileName,
        mimeType: mediaType,
        fileSize: bytes.length,
        storagePath: "pending",
        indexingStatus: "PROCESSING",
      },
    });
  } catch (error) {
    logger.error("[DATABASE] create_failed", {
      error: formatSourceUploadError(error),
    });
    throw new Error("Database error");
  }

  let storedKey: string | null = null;
  let storedRemote = false;

  try {
    logger.info("[STORE] begin", { sourceId: pending.id });
    const stored = await storeUpload({
      attachmentId: pending.id,
      filename: originalFileName,
      mediaType,
      bytes,
    });
    storedKey = stored.storageKey;
    storedRemote = stored.storage === "VERCEL_BLOB";
    logger.info("[STORE] complete", {
      sourceId: pending.id,
      storage: stored.storage,
      storageKey: stored.storageKey,
    });

    logger.info("[EXTRACT] begin", {
      sourceId: pending.id,
      mimeType: mediaType,
    });

    let extractedText: string | null = null;
    try {
      const extracted = await extractAttachmentContent({
        attachmentId: pending.id,
        filename: originalFileName,
        mediaType,
        bytes,
      });
      extractedText = extracted.extractedText?.trim() || null;
    } catch (error) {
      logger.error("[EXTRACT] failed", {
        sourceId: pending.id,
        error: error instanceof Error ? error.message : String(error),
      });
      if (mediaType === "application/pdf") {
        throw new Error("PDF parsing failed");
      }
      throw new Error("Text extraction failed");
    }

    if (!extractedText) {
      logger.warn("[EXTRACT] empty", { sourceId: pending.id });
      throw new Error(
        mediaType === "application/pdf"
          ? "PDF parsing failed"
          : "No extractable text found in this file."
      );
    }

    logger.info("[EXTRACT] complete", {
      sourceId: pending.id,
      chars: extractedText.length,
    });

    // Upload pipeline complete. PENDING + extracted text unlocks chat.
    // Embeddings / INDEXED are intentionally deferred.
    const saved = await prisma.source.update({
      where: { id: pending.id },
      data: {
        storagePath: stored.storageKey,
        extractedText,
        indexingStatus: "PENDING",
      },
    });

    logger.info("[UPLOAD] complete", {
      sourceId: saved.id,
      notebookId: saved.notebookId,
      indexingStatus: saved.indexingStatus,
      hasExtractedText: true,
    });

    return saved;
  } catch (error) {
    logger.error("[UPLOAD] failed", {
      sourceId: pending.id,
      error: formatSourceUploadError(error),
    });

    if (storedKey) {
      try {
        await deleteStoredUpload({
          objectId: pending.id,
          storage: storedRemote ? "VERCEL_BLOB" : "LOCAL",
          storageKey: storedKey,
        });
        logger.info("[STORE] cleanup_complete", { sourceId: pending.id });
      } catch (cleanupError) {
        logger.warn("[STORE] cleanup_failed", {
          sourceId: pending.id,
          error:
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError),
        });
      }
    }

    try {
      await prisma.source.update({
        where: { id: pending.id },
        data: {
          indexingStatus: "FAILED",
          storagePath: storedKey ?? "pending",
          extractedText: null,
        },
      });
    } catch {
      // Best-effort status update.
    }

    throw error instanceof Error
      ? error
      : new Error(formatSourceUploadError(error));
  }
}

export async function renameSourceForUser(input: {
  userId: string;
  sourceId: string;
  title: string;
}): Promise<SourceRecord> {
  await assertSourceOwner(input.sourceId, input.userId);

  const title = input.title.trim();
  if (!title) {
    throw new Error("Title is required");
  }
  if (title.length > SOURCE_TITLE_MAX_LENGTH) {
    throw new Error(
      `Title must be at most ${SOURCE_TITLE_MAX_LENGTH} characters`
    );
  }

  return prisma.source.update({
    where: { id: input.sourceId },
    data: { title },
  });
}

/**
 * Deletes source metadata, extracted text, and the stored file.
 * Does not touch embeddings (none exist for sources yet).
 */
export async function deleteSourceForUser(input: {
  userId: string;
  sourceId: string;
}): Promise<void> {
  const source = await assertSourceOwner(input.sourceId, input.userId);

  if (source.storagePath && source.storagePath !== "pending") {
    await deleteStoredUpload({
      objectId: source.id,
      storage: isRemoteStoragePath(source.storagePath)
        ? "VERCEL_BLOB"
        : "LOCAL",
      storageKey: source.storagePath,
    });
  }

  await prisma.source.delete({
    where: { id: source.id },
  });
}

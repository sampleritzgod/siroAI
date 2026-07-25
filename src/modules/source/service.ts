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
import { indexSourceForRag } from "@/modules/rag/index-source";
import { stageLog } from "@/modules/rag/pipeline-log";
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
 * Upload → store → extract.
 * Returns PROCESSING quickly so the client can show indexing progress.
 * Call finalizeSourceIndexing (usually via after()) for chunk → embed → INDEXED.
 */
export async function createSourceFromUpload(input: {
  userId: string;
  notebookId: string;
  file: File;
}): Promise<SourceRecord> {
  const uploadStage = stageLog("UPLOAD");

  uploadStage.started({
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
    uploadStage.error(new Error("Unsupported file type"), {
      filename: originalFileName,
      declaredType: input.file.type,
    });
    throw new Error(
      "Unsupported file type. Only PDF and plain text are allowed."
    );
  }

  if (input.file.size <= 0) {
    uploadStage.error(new Error("File is empty"));
    throw new Error("File is empty.");
  }

  if (input.file.size > MAX_UPLOAD_BYTES) {
    uploadStage.error(new Error("File too large"), {
      size: input.file.size,
      max: MAX_UPLOAD_BYTES,
    });
    throw new Error(
      `File too large. Maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`
    );
  }

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const type = sourceTypeFromMediaType(mediaType);
  const title = defaultTitleFromFilename(originalFileName);

  const sourceStage = stageLog("SOURCE");
  sourceStage.started({
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
    sourceStage.completed({
      sourceId: pending.id,
      notebookId: pending.notebookId,
      indexingStatus: pending.indexingStatus,
    });
  } catch (error) {
    sourceStage.error(error);
    throw new Error("Database error");
  }

  let storedKey: string | null = null;
  let storedRemote = false;

  try {
    const storeStage = stageLog("STORE");
    storeStage.started({ sourceId: pending.id });
    const stored = await storeUpload({
      attachmentId: pending.id,
      filename: originalFileName,
      mediaType,
      bytes,
    });
    storedKey = stored.storageKey;
    storedRemote = stored.storage === "VERCEL_BLOB";
    storeStage.completed({
      sourceId: pending.id,
      storage: stored.storage,
      storageKey: stored.storageKey,
      notebookId: input.notebookId,
    });

    const extractStage = stageLog("EXTRACT");
    extractStage.started({
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
      extractStage.error(error, { sourceId: pending.id });
      if (mediaType === "application/pdf") {
        throw new Error("PDF extraction failed");
      }
      throw new Error("Text extraction failed");
    }

    if (!extractedText) {
      const error = new Error(
        mediaType === "application/pdf"
          ? "PDF extraction failed"
          : "No extractable text found in this file."
      );
      extractStage.error(error, { sourceId: pending.id });
      throw error;
    }

    if (extractedText.startsWith("SIRO_PDF_VISION:")) {
      const newline = extractedText.indexOf("\n");
      const remainder =
        newline === -1 ? "" : extractedText.slice(newline).trim();
      if (!remainder) {
        const error = new Error(
          "PDF extraction failed: no embeddable text (image-only PDF)."
        );
        extractStage.error(error, { sourceId: pending.id });
        throw error;
      }
      extractedText = remainder;
    }

    extractStage.completed({
      sourceId: pending.id,
      chars: extractedText.length,
      encoding: "utf8",
    });

    const saved = await prisma.source.update({
      where: { id: pending.id },
      data: {
        storagePath: stored.storageKey,
        extractedText,
        indexingStatus: "PROCESSING",
      },
    });

    uploadStage.completed({
      sourceId: saved.id,
      notebookId: saved.notebookId,
      indexingStatus: saved.indexingStatus,
      hasExtractedText: true,
      indexing: "queued",
    });

    return saved;
  } catch (error) {
    uploadStage.error(error, { sourceId: pending.id });
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
      await prisma.$executeRaw`
        DELETE FROM "DocumentChunk" WHERE "sourceId" = ${pending.id}
      `;
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

/**
 * Chunk → embed → persist vectors → INDEXED (or FAILED).
 * Intended to run after upload returns (e.g. Next.js after()).
 */
export async function finalizeSourceIndexing(input: {
  sourceId: string;
  notebookId: string;
}): Promise<SourceRecord> {
  const source = await prisma.source.findFirst({
    where: {
      id: input.sourceId,
      notebookId: input.notebookId,
    },
  });

  if (!source) {
    throw new Error("Source not found");
  }

  if (source.indexingStatus === "INDEXED") {
    return source;
  }

  if (!source.extractedText?.trim()) {
    const failed = await prisma.source.update({
      where: { id: source.id },
      data: { indexingStatus: "FAILED" },
    });
    throw new Error("No extractable text found for embeddings");
  }

  try {
    await prisma.source.update({
      where: { id: source.id },
      data: { indexingStatus: "PROCESSING" },
    });

    const indexed = await indexSourceForRag({
      sourceId: source.id,
      notebookId: source.notebookId,
      extractedText: source.extractedText,
    });

    if (indexed.skipped || indexed.chunkCount === 0) {
      throw new Error(
        indexed.reason === "no_indexable_text"
          ? "No extractable text found for embeddings"
          : "Chunking produced zero chunks"
      );
    }

    const saved = await prisma.source.update({
      where: { id: source.id },
      data: { indexingStatus: "INDEXED" },
    });

    logger.info("[UPLOAD] indexing_complete", {
      sourceId: saved.id,
      notebookId: saved.notebookId,
      chunkCount: indexed.chunkCount,
      averageChunkSize: indexed.averageChunkSize,
      embeddingDimensions: indexed.embeddingDimensions,
    });

    return saved;
  } catch (error) {
    logger.error("[UPLOAD] indexing_failed", {
      sourceId: source.id,
      error: formatSourceUploadError(error),
    });

    await prisma.$executeRaw`
      DELETE FROM "DocumentChunk" WHERE "sourceId" = ${source.id}
    `;
    await prisma.source.update({
      where: { id: source.id },
      data: { indexingStatus: "FAILED" },
    });

    throw error instanceof Error
      ? error
      : new Error(formatSourceUploadError(error));
  }
}

/** Test helper: upload + finish indexing in one call. */
export async function createIndexedSourceFromUpload(input: {
  userId: string;
  notebookId: string;
  file: File;
}): Promise<SourceRecord> {
  const uploaded = await createSourceFromUpload(input);
  return finalizeSourceIndexing({
    sourceId: uploaded.id,
    notebookId: uploaded.notebookId,
  });
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
 * Deletes source metadata, extracted text, DocumentChunks, and the stored file.
 */
export async function deleteSourceForUser(input: {
  userId: string;
  sourceId: string;
}): Promise<void> {
  const source = await assertSourceOwner(input.sourceId, input.userId);

  await prisma.$executeRaw`
    DELETE FROM "DocumentChunk" WHERE "sourceId" = ${source.id}
  `;

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

  logger.info("[SOURCE] deleted", {
    sourceId: source.id,
    notebookId: source.notebookId,
  });
}

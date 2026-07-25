import type {
  SourceIndexingStatus,
  SourceType,
} from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { extractAttachmentContent } from "@/modules/files/extract-text";
import {
  deleteStoredUpload,
  storeUpload,
} from "@/modules/files/storage";
import {
  MAX_UPLOAD_BYTES,
  SOURCE_TITLE_MAX_LENGTH,
  defaultTitleFromFilename,
  isRemoteStoragePath,
  isSourceAllowedMediaType,
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
 * Upload + extract a notebook source. Does not create embeddings / RAG index.
 */
export async function createSourceFromUpload(input: {
  userId: string;
  notebookId: string;
  file: File;
}): Promise<SourceRecord> {
  await assertNotebookOwner(input.notebookId, input.userId);

  const mediaType = (input.file.type || "application/octet-stream").toLowerCase();
  if (!isSourceAllowedMediaType(mediaType)) {
    throw new Error("Unsupported file type. Only PDF and plain text are allowed.");
  }

  if (input.file.size <= 0 || input.file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `File must be between 1 byte and ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`
    );
  }

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const originalFileName = input.file.name?.trim() || "upload";
  const type = sourceTypeFromMediaType(mediaType);
  const title = defaultTitleFromFilename(originalFileName);

  const pending = await prisma.source.create({
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

  try {
    const stored = await storeUpload({
      attachmentId: pending.id,
      filename: originalFileName,
      mediaType,
      bytes,
    });

    const extracted = await extractAttachmentContent({
      attachmentId: pending.id,
      filename: originalFileName,
      mediaType,
      bytes,
    });

    // Text is stored for the future indexing phase — status stays PENDING (not INDEXED).
    return prisma.source.update({
      where: { id: pending.id },
      data: {
        storagePath: stored.storageKey,
        extractedText: extracted.extractedText,
        indexingStatus: "PENDING",
      },
    });
  } catch (error) {
    await prisma.source.update({
      where: { id: pending.id },
      data: { indexingStatus: "FAILED" },
    });
    throw error;
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

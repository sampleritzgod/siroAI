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
  WEBSITE_STORAGE_PATH,
  YOUTUBE_STORAGE_PATH,
  defaultTitleFromFilename,
  formatSourceUploadError,
  isRemoteStoragePath,
  resolveSourceMediaType,
  sourceTypeFromMediaType,
} from "@/modules/source/constants";
import {
  defaultTitleFromWebsite,
  fetchWebsiteContent,
  normalizeWebsiteUrl,
} from "@/modules/source/fetch-website";
import {
  fetchYoutubeContent,
  normalizeYoutubeUrl,
  toYoutubeMetadata,
  type YoutubeSourceMetadata,
} from "@/modules/source/fetch-youtube";
import {
  defaultTitleFromVttFilename,
  parseVtt,
  toVttMetadata,
  type ParsedVtt,
  type VttSourceMetadata,
} from "@/modules/source/parse-vtt";
import {
  cancelJobByIdempotencyKey,
  indexSourceIdempotencyKey,
} from "@/modules/jobs/queue";

/**
 * Source.metadata is source-type specific. Fields are optional so one type can
 * describe every variant (YouTube video info, VTT cue info).
 */
export type SourceMetadata = Partial<YoutubeSourceMetadata> &
  Partial<VttSourceMetadata>;

export type SourceRecord = {
  id: string;
  notebookId: string;
  type: SourceType;
  title: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  url: string | null;
  metadata: SourceMetadata | null;
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
  url: string | null;
  metadata: SourceMetadata | null;
  indexingStatus: SourceIndexingStatus;
  hasExtractedText: boolean;
  createdAt: Date;
  updatedAt: Date;
};

async function assertNotebookOwner(notebookId: string, userId: string) {
  const notebook = await prisma.notebook.findFirst({
    where: { id: notebookId, userId, deletedAt: null },
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
      notebook: { userId, deletedAt: null },
    },
  });

  if (!source) {
    throw new Error("Source not found");
  }

  return source;
}

const STALE_PROCESSING_MS = 10 * 60 * 1000;
/** Avoid writing on every 1s router.refresh() while a source is indexing. */
const STALE_SWEEP_INTERVAL_MS = 60_000;
const lastStaleSweepAt = new Map<string, number>();

/**
 * Mark sources stuck in PROCESSING longer than the timeout as FAILED.
 * Prevents the 1s refresh loop from running forever after a crashed after().
 * Debounced so list endpoints do not UPDATE on every poll tick.
 */
async function failStaleProcessingSources(where: {
  notebookId?: string;
  userId?: string;
}) {
  const sweepKey = where.notebookId
    ? `nb:${where.notebookId}`
    : where.userId
      ? `user:${where.userId}`
      : "global";
  const now = Date.now();
  const last = lastStaleSweepAt.get(sweepKey) ?? 0;
  if (now - last < STALE_SWEEP_INTERVAL_MS) {
    return;
  }
  lastStaleSweepAt.set(sweepKey, now);

  const cutoff = new Date(now - STALE_PROCESSING_MS);
  await prisma.source.updateMany({
    where: {
      indexingStatus: "PROCESSING",
      updatedAt: { lt: cutoff },
      ...(where.notebookId ? { notebookId: where.notebookId } : {}),
      ...(where.userId
        ? { notebook: { userId: where.userId, deletedAt: null } }
        : {}),
    },
    data: { indexingStatus: "FAILED" },
  });
}

function parseSourceMetadata(value: unknown): SourceMetadata | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;

  const metadata: SourceMetadata = {
    durationSeconds:
      typeof record.durationSeconds === "number"
        ? record.durationSeconds
        : null,
  };

  if (typeof record.videoId === "string") {
    metadata.videoId = record.videoId;
    metadata.channel =
      typeof record.channel === "string" ? record.channel : null;
    metadata.thumbnailUrl =
      typeof record.thumbnailUrl === "string" ? record.thumbnailUrl : null;
  }

  if (typeof record.cueCount === "number") {
    metadata.cueCount = record.cueCount;
    metadata.language =
      typeof record.language === "string" ? record.language : null;
  }

  const isKnownShape =
    metadata.videoId != null || metadata.cueCount != null;
  return isKnownShape ? metadata : null;
}

function toSourceRecord(row: {
  id: string;
  notebookId: string;
  type: SourceType;
  title: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  url: string | null;
  metadata: unknown;
  extractedText: string | null;
  indexingStatus: SourceIndexingStatus;
  createdAt: Date;
  updatedAt: Date;
}): SourceRecord {
  return {
    id: row.id,
    notebookId: row.notebookId,
    type: row.type,
    title: row.title,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    storagePath: row.storagePath,
    url: row.url,
    metadata: parseSourceMetadata(row.metadata),
    extractedText: row.extractedText,
    indexingStatus: row.indexingStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSourceListItem(row: {
  id: string;
  notebookId: string;
  type: SourceType;
  title: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  url: string | null;
  metadata: unknown;
  indexingStatus: SourceIndexingStatus;
  createdAt: Date;
  updatedAt: Date;
  hasExtractedText: boolean;
}): SourceListItem {
  return {
    id: row.id,
    notebookId: row.notebookId,
    type: row.type,
    title: row.title,
    originalFileName: row.originalFileName,
    mimeType: row.mimeType,
    fileSize: row.fileSize,
    url: row.url,
    metadata: parseSourceMetadata(row.metadata),
    indexingStatus: row.indexingStatus,
    hasExtractedText: row.hasExtractedText,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listSourcesForNotebook(input: {
  userId: string;
  notebookId: string;
}): Promise<SourceListItem[]> {
  await assertNotebookOwner(input.notebookId, input.userId);
  await failStaleProcessingSources({ notebookId: input.notebookId });

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      notebookId: string;
      type: SourceType;
      title: string;
      originalFileName: string;
      mimeType: string;
      fileSize: number;
      url: string | null;
      metadata: unknown;
      indexingStatus: SourceIndexingStatus;
      createdAt: Date;
      updatedAt: Date;
      hasExtractedText: boolean;
    }>
  >`
    SELECT
      id,
      "notebookId",
      type,
      title,
      "originalFileName",
      "mimeType",
      "fileSize",
      url,
      metadata,
      "indexingStatus",
      "createdAt",
      "updatedAt",
      (
        "extractedText" IS NOT NULL
        AND length(btrim("extractedText")) > 0
      ) AS "hasExtractedText"
    FROM "Source"
    WHERE "notebookId" = ${input.notebookId}
    ORDER BY "createdAt" DESC
  `;

  return rows.map(toSourceListItem);
}

export async function listSourcesForUser(userId: string): Promise<SourceListItem[]> {
  await failStaleProcessingSources({ userId });

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      notebookId: string;
      type: SourceType;
      title: string;
      originalFileName: string;
      mimeType: string;
      fileSize: number;
      url: string | null;
      metadata: unknown;
      indexingStatus: SourceIndexingStatus;
      createdAt: Date;
      updatedAt: Date;
      hasExtractedText: boolean;
    }>
  >`
    SELECT
      s.id,
      s."notebookId",
      s.type,
      s.title,
      s."originalFileName",
      s."mimeType",
      s."fileSize",
      s.url,
      s.metadata,
      s."indexingStatus",
      s."createdAt",
      s."updatedAt",
      (
        s."extractedText" IS NOT NULL
        AND length(btrim(s."extractedText")) > 0
      ) AS "hasExtractedText"
    FROM "Source" s
    INNER JOIN "Notebook" n ON n.id = s."notebookId"
    WHERE n."userId" = ${userId}
      AND n."deletedAt" IS NULL
    ORDER BY s."createdAt" DESC
  `;

  return rows.map(toSourceListItem);
}

export async function getSourceForUser(input: {
  userId: string;
  sourceId: string;
}): Promise<SourceRecord | null> {
  const row = await prisma.source.findFirst({
    where: {
      id: input.sourceId,
      notebook: { userId: input.userId, deletedAt: null },
    },
  });
  return row ? toSourceRecord(row) : null;
}

/**
 * Subtitle files carry no URL to dedupe on, so treat an identical filename and
 * byte size within the same notebook as a re-upload of the same file.
 */
async function assertNoDuplicateVtt(input: {
  notebookId: string;
  originalFileName: string;
  fileSize: number;
}) {
  const duplicate = await prisma.source.findFirst({
    where: {
      notebookId: input.notebookId,
      type: "VTT",
      originalFileName: input.originalFileName,
      fileSize: input.fileSize,
    },
    select: { id: true },
  });

  if (duplicate) {
    throw new Error("This subtitle file is already added to the notebook.");
  }
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
      "Unsupported file type. Only PDF, plain text, and VTT subtitles are allowed."
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
  const title =
    type === "VTT"
      ? defaultTitleFromVttFilename(originalFileName)
      : defaultTitleFromFilename(originalFileName);

  // Subtitle files are parsed up front so an invalid .vtt fails before we store
  // the file or create a row. Other types keep the existing extract-after-store
  // flow (PDF extraction needs the file on disk).
  let parsedVtt: ParsedVtt | null = null;
  if (type === "VTT") {
    await assertNoDuplicateVtt({
      notebookId: input.notebookId,
      originalFileName,
      fileSize: bytes.length,
    });

    const extractStage = stageLog("EXTRACT");
    extractStage.started({
      notebookId: input.notebookId,
      mimeType: mediaType,
      kind: "vtt",
    });
    try {
      parsedVtt = parseVtt(bytes.toString("utf8"));
    } catch (error) {
      extractStage.error(error, { filename: originalFileName });
      uploadStage.error(error, { filename: originalFileName });
      throw error instanceof Error
        ? error
        : new Error("Invalid VTT file: could not parse subtitles.");
    }
    extractStage.completed({
      chars: parsedVtt.transcript.length,
      cueCount: parsedVtt.cueCount,
      language: parsedVtt.language,
    });
  }

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
    if (parsedVtt) {
      // Already parsed above; skip generic text extraction so cue timings and
      // metadata never reach the embeddings.
      extractedText = parsedVtt.transcript;
    } else {
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
      // Vision fallback notes are not real document text — reject them.
      const isVisionStub =
        !remainder ||
        remainder.startsWith("[PDF has no extractable text layer");
      if (isVisionStub) {
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
        ...(parsedVtt ? { metadata: toVttMetadata(parsedVtt) } : {}),
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

    return toSourceRecord(saved);
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
 * Fetch a website URL → extract readable text → PROCESSING.
 * Reuses finalizeSourceIndexing for chunk → embed → INDEXED.
 */
export async function createSourceFromWebsite(input: {
  userId: string;
  notebookId: string;
  url: string;
}): Promise<SourceRecord> {
  await assertNotebookOwner(input.notebookId, input.userId);

  const uploadStage = stageLog("UPLOAD");
  uploadStage.started({
    notebookId: input.notebookId,
    kind: "website",
    url: input.url,
  });

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeWebsiteUrl(input.url);
  } catch (error) {
    uploadStage.error(error);
    throw error instanceof Error ? error : new Error("Invalid URL");
  }

  const duplicate = await prisma.source.findFirst({
    where: {
      notebookId: input.notebookId,
      type: "WEBSITE",
      url: normalizedUrl,
    },
    select: { id: true },
  });

  if (duplicate) {
    const error = new Error("This website is already added to the notebook.");
    uploadStage.error(error);
    throw error;
  }

  let page;
  try {
    page = await fetchWebsiteContent(normalizedUrl);
  } catch (error) {
    uploadStage.error(error);
    throw error instanceof Error
      ? error
      : new Error(formatSourceUploadError(error));
  }

  const title = defaultTitleFromWebsite({
    pageTitle: page.title,
    url: page.url,
  });
  let hostname = "website";
  try {
    hostname = new URL(page.url).hostname.replace(/^www\./, "") || "website";
  } catch {
    // keep default
  }

  try {
    const saved = await prisma.source.create({
      data: {
        notebookId: input.notebookId,
        type: "WEBSITE",
        title,
        originalFileName: hostname,
        mimeType: "text/html",
        fileSize: page.htmlBytes,
        storagePath: WEBSITE_STORAGE_PATH,
        url: page.url,
        extractedText: page.text,
        indexingStatus: "PROCESSING",
      },
    });

    uploadStage.completed({
      sourceId: saved.id,
      notebookId: saved.notebookId,
      indexingStatus: saved.indexingStatus,
      hasExtractedText: true,
      indexing: "queued",
      url: saved.url,
      chars: page.text.length,
    });

    return toSourceRecord(saved);
  } catch (error) {
    uploadStage.error(error);
    if (
      error instanceof Error &&
      /unique|duplicate/i.test(error.message)
    ) {
      throw new Error("This website is already added to the notebook.");
    }
    throw new Error("Database error");
  }
}

/**
 * Fetch a YouTube transcript → PROCESSING.
 * Reuses finalizeSourceIndexing for chunk → embed → INDEXED.
 */
export async function createSourceFromYoutube(input: {
  userId: string;
  notebookId: string;
  url: string;
}): Promise<SourceRecord> {
  await assertNotebookOwner(input.notebookId, input.userId);

  const uploadStage = stageLog("UPLOAD");
  uploadStage.started({
    notebookId: input.notebookId,
    kind: "youtube",
    url: input.url,
  });

  let normalizedUrl: string;
  try {
    normalizedUrl = normalizeYoutubeUrl(input.url);
  } catch (error) {
    uploadStage.error(error);
    throw error instanceof Error ? error : new Error("Invalid YouTube URL");
  }

  const duplicate = await prisma.source.findFirst({
    where: {
      notebookId: input.notebookId,
      type: "YOUTUBE",
      url: normalizedUrl,
    },
    select: { id: true },
  });

  if (duplicate) {
    const error = new Error(
      "This YouTube video is already added to the notebook."
    );
    uploadStage.error(error);
    throw error;
  }

  let video;
  try {
    video = await fetchYoutubeContent(normalizedUrl);
  } catch (error) {
    uploadStage.error(error);
    throw error instanceof Error
      ? error
      : new Error(formatSourceUploadError(error));
  }

  try {
    const saved = await prisma.source.create({
      data: {
        notebookId: input.notebookId,
        type: "YOUTUBE",
        title: video.title,
        originalFileName: video.channel || video.videoId,
        mimeType: "text/plain",
        fileSize: video.transcriptBytes,
        storagePath: YOUTUBE_STORAGE_PATH,
        url: video.url,
        metadata: toYoutubeMetadata(video),
        extractedText: video.transcript,
        indexingStatus: "PROCESSING",
      },
    });

    uploadStage.completed({
      sourceId: saved.id,
      notebookId: saved.notebookId,
      indexingStatus: saved.indexingStatus,
      hasExtractedText: true,
      indexing: "queued",
      url: saved.url,
      videoId: video.videoId,
      chars: video.transcript.length,
    });

    return toSourceRecord(saved);
  } catch (error) {
    uploadStage.error(error);
    if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
      throw new Error("This YouTube video is already added to the notebook.");
    }
    throw new Error("Database error");
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
    return toSourceRecord(source);
  }

  if (!source.extractedText?.trim()) {
    await prisma.source.update({
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

    return toSourceRecord(saved);
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

/** Test helper: website fetch + finish indexing in one call. */
export async function createIndexedSourceFromWebsite(input: {
  userId: string;
  notebookId: string;
  url: string;
}): Promise<SourceRecord> {
  const created = await createSourceFromWebsite(input);
  return finalizeSourceIndexing({
    sourceId: created.id,
    notebookId: created.notebookId,
  });
}

/** Test helper: YouTube fetch + finish indexing in one call. */
export async function createIndexedSourceFromYoutube(input: {
  userId: string;
  notebookId: string;
  url: string;
}): Promise<SourceRecord> {
  const created = await createSourceFromYoutube(input);
  return finalizeSourceIndexing({
    sourceId: created.id,
    notebookId: created.notebookId,
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
  }).then(toSourceRecord);
}

/**
 * Deletes source metadata, extracted text, DocumentChunks, and the stored file.
 */
export async function deleteSourceForUser(input: {
  userId: string;
  sourceId: string;
}): Promise<void> {
  const source = await assertSourceOwner(input.sourceId, input.userId);

  await cancelJobByIdempotencyKey(indexSourceIdempotencyKey(source.id));

  await prisma.$executeRaw`
    DELETE FROM "DocumentChunk" WHERE "sourceId" = ${source.id}
  `;

  if (
    source.type !== "WEBSITE" &&
    source.type !== "YOUTUBE" &&
    source.storagePath &&
    source.storagePath !== "pending" &&
    source.storagePath !== WEBSITE_STORAGE_PATH &&
    source.storagePath !== YOUTUBE_STORAGE_PATH
  ) {
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

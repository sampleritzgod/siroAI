import { prisma } from "@/lib/db";
import type { CitationSourceKind } from "@/modules/rag/citation-types";
import {
  getSourceForUser,
  type SourceMetadata,
} from "@/modules/source/service";

/** Keep the modal payload small — viewers scroll, they don't need whole books. */
export const MAX_VIEWER_TEXT_CHARS = 120_000;

export type SourceViewerData = {
  id: string;
  kind: "SOURCE" | "ATTACHMENT";
  type: CitationSourceKind;
  title: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  /** External URL for WEBSITE / YOUTUBE sources. */
  url: string | null;
  /** Authenticated app route that streams the stored file (S3-backed). */
  fileUrl: string | null;
  text: string | null;
  textTruncated: boolean;
  metadata: SourceMetadata | null;
  /** Content of the cited chunk, used to scroll/highlight inside the text. */
  chunkText: string | null;
  chunkIndex: number | null;
};

export type SourceViewerQuery = {
  userId: string;
  sourceId?: string | null;
  attachmentId?: string | null;
  chunkIndex?: number | null;
};

/**
 * Read-only payload for the Source Viewer modal.
 * Reuses existing ownership checks; binary content keeps streaming through
 * /api/sources/[id] (or /api/files/[id]) so S3 objects stay private.
 */
export async function loadSourceViewerData(
  input: SourceViewerQuery
): Promise<SourceViewerData | null> {
  const chunkIndex =
    typeof input.chunkIndex === "number" && input.chunkIndex >= 0
      ? input.chunkIndex
      : null;

  if (input.sourceId) {
    const source = await getSourceForUser({
      userId: input.userId,
      sourceId: input.sourceId,
    });
    if (!source) return null;

    const isFileBacked = source.type !== "WEBSITE" && source.type !== "YOUTUBE";
    const chunkText = await readChunkText({
      sourceId: source.id,
      chunkIndex,
    });
    const { text, truncated } = truncate(source.extractedText);

    return {
      id: source.id,
      kind: "SOURCE",
      type: source.type,
      title: source.title,
      originalFileName: source.originalFileName,
      mimeType: source.mimeType,
      fileSize: source.fileSize,
      url: source.url,
      fileUrl: isFileBacked ? `/api/sources/${source.id}` : null,
      text,
      textTruncated: truncated,
      metadata: source.metadata,
      chunkText,
      chunkIndex,
    };
  }

  if (input.attachmentId) {
    const attachment = await prisma.attachment.findFirst({
      where: {
        id: input.attachmentId,
        userId: input.userId,
        conversation: {
          notebook: { userId: input.userId, deletedAt: null },
        },
      },
      select: {
        id: true,
        filename: true,
        mediaType: true,
        sizeBytes: true,
        extractedText: true,
      },
    });
    if (!attachment) return null;

    const chunkText = await readChunkText({
      attachmentId: attachment.id,
      chunkIndex,
    });
    // Vision payloads are page-image JSON, not readable text.
    const raw = attachment.extractedText?.startsWith("SIRO_PDF_VISION:")
      ? null
      : attachment.extractedText;
    const { text, truncated } = truncate(raw);

    return {
      id: attachment.id,
      kind: "ATTACHMENT",
      type: "ATTACHMENT",
      title: attachment.filename,
      originalFileName: attachment.filename,
      mimeType: attachment.mediaType,
      fileSize: attachment.sizeBytes,
      url: null,
      fileUrl: `/api/files/${attachment.id}`,
      text,
      textTruncated: truncated,
      metadata: null,
      chunkText,
      chunkIndex,
    };
  }

  return null;
}

function truncate(text: string | null): {
  text: string | null;
  truncated: boolean;
} {
  if (!text) return { text: null, truncated: false };
  if (text.length <= MAX_VIEWER_TEXT_CHARS) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, MAX_VIEWER_TEXT_CHARS), truncated: true };
}

async function readChunkText(input: {
  sourceId?: string;
  attachmentId?: string;
  chunkIndex: number | null;
}): Promise<string | null> {
  if (input.chunkIndex == null) return null;

  // Chunk rows carry an Unsupported(vector) column, so this table is always
  // read with raw SQL in this codebase.
  const rows = input.sourceId
    ? await prisma.$queryRaw<Array<{ content: string }>>`
        SELECT content FROM "DocumentChunk"
        WHERE "sourceId" = ${input.sourceId}
          AND "chunkIndex" = ${input.chunkIndex}
        LIMIT 1
      `
    : input.attachmentId
      ? await prisma.$queryRaw<Array<{ content: string }>>`
          SELECT content FROM "DocumentChunk"
          WHERE "attachmentId" = ${input.attachmentId}
            AND "chunkIndex" = ${input.chunkIndex}
          LIMIT 1
        `
      : [];

  return rows[0]?.content ?? null;
}

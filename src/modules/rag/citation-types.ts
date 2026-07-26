import type { SourceType } from "@/generated/prisma/client";

/**
 * UI-only data part carrying the citations for one assistant turn.
 * Streamed and persisted with the message so `[1]` markers stay resolvable
 * after a reload. Data parts are ignored by convertToModelMessages.
 */
export const CITATIONS_PART_TYPE = "data-citations";

export type CitationSourceKind = SourceType | "ATTACHMENT";

export type MessageCitation = {
  /** 1-based label the model cites inline, e.g. [1]. */
  index: number;
  chunkId: string;
  sourceId: string | null;
  attachmentId: string | null;
  filename: string;
  sourceType: CitationSourceKind;
  chunkIndex: number;
  score: number;
  /** PDF page when the pipeline knows it; null means "open from the start". */
  page: number | null;
  url: string | null;
  snippet: string;
};

function isCitation(value: unknown): value is MessageCitation {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.index === "number" &&
    typeof candidate.chunkId === "string" &&
    typeof candidate.filename === "string" &&
    typeof candidate.chunkIndex === "number" &&
    typeof candidate.score === "number" &&
    (typeof candidate.sourceId === "string" || candidate.sourceId === null) &&
    (typeof candidate.attachmentId === "string" ||
      candidate.attachmentId === null)
  );
}

/**
 * Read citations off a message's parts (streamed live or loaded from the DB).
 * Returns [] when the turn had no retrieval, so callers can fall back to
 * rendering plain text instead of a broken citation.
 */
export function readCitationsFromParts(
  parts: ReadonlyArray<{ type: string; data?: unknown }>
): MessageCitation[] {
  for (const part of parts) {
    if (part.type !== CITATIONS_PART_TYPE) continue;
    if (!Array.isArray(part.data)) continue;
    const citations = part.data.filter(isCitation);
    if (citations.length > 0) return citations;
  }
  return [];
}

import { prisma } from "@/lib/db";
import type { MessageCitation } from "@/modules/rag/citation-types";
import type { RetrievedChunk } from "@/modules/rag/retrieve";

const SNIPPET_CHARS = 280;

/**
 * Turn already-retrieved chunks into UI citations, in the same order the
 * prompt numbered them (formatRetrievedContext uses the array index).
 *
 * Read-only: enriches with source type / URL so the viewer can render the
 * right layout. Retrieval, embeddings and vector search are untouched.
 */
export async function buildMessageCitations(
  chunks: RetrievedChunk[]
): Promise<MessageCitation[]> {
  if (chunks.length === 0) return [];

  const sourceIds = [
    ...new Set(
      chunks
        .map((chunk) => chunk.sourceId)
        .filter((id): id is string => Boolean(id))
    ),
  ];
  const attachmentIds = [
    ...new Set(
      chunks
        .map((chunk) => chunk.attachmentId)
        .filter((id): id is string => Boolean(id))
    ),
  ];

  const [sources, attachments] = await Promise.all([
    sourceIds.length > 0
      ? prisma.source.findMany({
          where: { id: { in: sourceIds } },
          select: {
            id: true,
            type: true,
            title: true,
            originalFileName: true,
            url: true,
          },
        })
      : Promise.resolve([]),
    attachmentIds.length > 0
      ? prisma.attachment.findMany({
          where: { id: { in: attachmentIds } },
          select: { id: true, filename: true },
        })
      : Promise.resolve([]),
  ]);

  const sourceById = new Map(sources.map((row) => [row.id, row]));
  const attachmentById = new Map(attachments.map((row) => [row.id, row]));

  return chunks.flatMap((chunk, position) => {
    const source = chunk.sourceId ? sourceById.get(chunk.sourceId) : undefined;
    const attachment = chunk.attachmentId
      ? attachmentById.get(chunk.attachmentId)
      : undefined;

    // The row disappeared (deleted mid-turn) — drop it rather than emit a
    // citation that cannot open.
    if (!source && !attachment) return [];

    return [
      {
        index: position + 1,
        chunkId: chunk.id,
        sourceId: chunk.sourceId,
        attachmentId: chunk.attachmentId,
        filename:
          source?.title ||
          source?.originalFileName ||
          attachment?.filename ||
          chunk.filename,
        sourceType: source?.type ?? ("ATTACHMENT" as const),
        chunkIndex: chunk.chunkIndex,
        score: Number(chunk.score.toFixed(4)),
        // The extraction pipeline stores merged text without page offsets.
        page: null,
        url: source?.url ?? null,
        snippet: chunk.content.slice(0, SNIPPET_CHARS),
      },
    ];
  });
}

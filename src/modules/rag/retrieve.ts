import { prisma } from "@/lib/db";
import { embedQuery, toVectorLiteral } from "@/modules/rag/embed";

export type RetrievedChunk = {
  id: string;
  attachmentId: string;
  filename: string;
  chunkIndex: number;
  content: string;
  score: number;
};

export async function retrieveRelevantChunks(input: {
  conversationId: string;
  query: string;
  limit?: number;
}): Promise<RetrievedChunk[]> {
  const query = input.query.trim();
  if (!query) return [];

  const limit = Math.min(Math.max(input.limit ?? 6, 1), 12);
  const embedding = await embedQuery(query);
  const vector = toVectorLiteral(embedding);

  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      attachmentId: string;
      filename: string;
      chunkIndex: number;
      content: string;
      score: number;
    }>
  >`
    SELECT
      c.id,
      c."attachmentId",
      a.filename,
      c."chunkIndex",
      c.content,
      (1 - (c.embedding <=> ${vector}::vector))::float8 AS score
    FROM "DocumentChunk" c
    INNER JOIN "Attachment" a ON a.id = c."attachmentId"
    WHERE c."conversationId" = ${input.conversationId}
    ORDER BY c.embedding <=> ${vector}::vector
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    ...row,
    score: Number(row.score),
  }));
}

/**
 * Format retrieved chunks for system / tool context with citation labels.
 */
export function formatRetrievedContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";

  const blocks = chunks.map((chunk, index) => {
    const n = index + 1;
    return [
      `[${n}] ${chunk.filename} (chunk ${chunk.chunkIndex + 1})`,
      chunk.content,
    ].join("\n");
  });

  return [
    "Retrieved document context for this conversation:",
    "Cite sources inline like [1], [2] when you use them.",
    "",
    ...blocks,
  ].join("\n");
}

import { prisma } from "@/lib/db";
import { embedQuery, toVectorLiteral } from "@/modules/rag/embed";
import { stageLog } from "@/modules/rag/pipeline-log";

/** Minimum cosine similarity for a chunk to count as relevant. */
export const MIN_RETRIEVAL_SCORE = 0.1;

export type RetrievedChunk = {
  id: string;
  attachmentId: string | null;
  sourceId: string | null;
  filename: string;
  chunkIndex: number;
  content: string;
  score: number;
};

/**
 * Retrieve relevant chunks for a chat turn.
 * Searches notebook sources (primary NotebookLM path) and conversation
 * attachments (legacy per-chat uploads).
 */
export async function retrieveRelevantChunks(input: {
  conversationId: string;
  notebookId?: string | null;
  query: string;
  limit?: number;
  minScore?: number;
}): Promise<RetrievedChunk[]> {
  const stage = stageLog("RETRIEVE");
  const query = input.query.trim();
  const minScore = input.minScore ?? MIN_RETRIEVAL_SCORE;

  if (!query) {
    stage.started({
      conversationId: input.conversationId,
      notebookId: input.notebookId ?? null,
      queryEmpty: true,
    });
    stage.completed({ retrievedCount: 0, reason: "empty_query" });
    return [];
  }

  const limit = Math.min(Math.max(input.limit ?? 6, 1), 12);
  stage.started({
    conversationId: input.conversationId,
    notebookId: input.notebookId ?? null,
    queryChars: query.length,
    limit,
    minScore,
  });

  try {
    const embedding = await embedQuery(query);
    const vector = toVectorLiteral(embedding);
    const notebookId = input.notebookId ?? null;

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        attachmentId: string | null;
        sourceId: string | null;
        filename: string;
        chunkIndex: number;
        content: string;
        score: number;
      }>
    >`
      SELECT
        c.id,
        c."attachmentId",
        c."sourceId",
        COALESCE(s.title, a.filename, s."originalFileName", 'document') AS filename,
        c."chunkIndex",
        c.content,
        (1 - (c.embedding <=> ${vector}::vector))::float8 AS score
      FROM "DocumentChunk" c
      LEFT JOIN "Attachment" a ON a.id = c."attachmentId"
      LEFT JOIN "Source" s ON s.id = c."sourceId"
      WHERE (
        c."conversationId" = ${input.conversationId}
        OR (
          ${notebookId}::text IS NOT NULL
          AND c."notebookId" = ${notebookId}
        )
      )
      ORDER BY c.embedding <=> ${vector}::vector
      LIMIT ${limit}
    `;

    const scored = rows.map((row) => ({
      ...row,
      score: Number(row.score),
    }));

    const chunks = scored.filter((chunk) => chunk.score >= minScore);

    stage.completed({
      conversationId: input.conversationId,
      notebookId,
      retrievedCount: chunks.length,
      candidateCount: scored.length,
      filteredOut: scored.length - chunks.length,
      chunkIds: chunks.map((chunk) => chunk.id),
      sourceIds: chunks
        .map((chunk) => chunk.sourceId)
        .filter((id): id is string => Boolean(id)),
      attachmentIds: chunks
        .map((chunk) => chunk.attachmentId)
        .filter((id): id is string => Boolean(id)),
      scores: chunks.map((chunk) => Number(chunk.score.toFixed(4))),
    });

    return chunks;
  } catch (error) {
    stage.error(error, {
      conversationId: input.conversationId,
      notebookId: input.notebookId ?? null,
    });
    throw error;
  }
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
    "Retrieved notebook document context:",
    "Ground your answer in this context. Cite sources inline like [1], [2] when you use them.",
    "If the context does not contain the answer, say clearly that the information is not present in the notebook sources.",
    "",
    ...blocks,
  ].join("\n");
}

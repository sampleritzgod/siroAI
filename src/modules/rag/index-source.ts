import { prisma } from "@/lib/db";
import { chunkText } from "@/modules/rag/chunk";
import {
  EMBEDDING_DIMENSIONS,
  embedTexts,
  toVectorLiteral,
} from "@/modules/rag/embed";
import { createId } from "@/modules/rag/ids";
import { stageLog } from "@/modules/rag/pipeline-log";

export type IndexSourceResult = {
  chunkCount: number;
  averageChunkSize: number;
  embeddingDimensions: number;
  skipped: boolean;
  reason?: string;
};

/**
 * Index (or re-index) a notebook source's extracted text into DocumentChunk rows.
 * Scoped by notebookId + sourceId for notebook-level retrieval.
 */
export async function indexSourceForRag(input: {
  sourceId: string;
  notebookId: string;
  extractedText: string | null | undefined;
}): Promise<IndexSourceResult> {
  const chunkStage = stageLog("CHUNK");
  const embedStage = stageLog("EMBED");
  const vectorStage = stageLog("VECTOR");

  const text = indexableSourceText(input.extractedText);
  if (!text) {
    chunkStage.started({ sourceId: input.sourceId, notebookId: input.notebookId });
    await prisma.$executeRaw`
      DELETE FROM "DocumentChunk" WHERE "sourceId" = ${input.sourceId}
    `;
    chunkStage.completed({
      sourceId: input.sourceId,
      chunkCount: 0,
      skipped: true,
      reason: "no_indexable_text",
    });
    return {
      chunkCount: 0,
      averageChunkSize: 0,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
      skipped: true,
      reason: "no_indexable_text",
    };
  }

  chunkStage.started({
    sourceId: input.sourceId,
    notebookId: input.notebookId,
    chars: text.length,
  });

  const chunks = chunkText(text);
  const averageChunkSize =
    chunks.length === 0
      ? 0
      : Math.round(
          chunks.reduce((sum, chunk) => sum + chunk.content.length, 0) /
            chunks.length
        );

  chunkStage.completed({
    sourceId: input.sourceId,
    chunkCount: chunks.length,
    averageChunkSize,
    chunkIndexes: chunks.map((chunk) => chunk.index),
  });

  if (chunks.length === 0) {
    return {
      chunkCount: 0,
      averageChunkSize: 0,
      embeddingDimensions: EMBEDDING_DIMENSIONS,
      skipped: true,
      reason: "no_chunks",
    };
  }

  embedStage.started({
    sourceId: input.sourceId,
    chunkCount: chunks.length,
  });

  let embeddings: number[][];
  try {
    embeddings = await embedTexts(chunks.map((chunk) => chunk.content));
  } catch (error) {
    embedStage.error(error, { sourceId: input.sourceId });
    throw error;
  }

  const missing = chunks.length - embeddings.length;
  if (missing > 0 || embeddings.some((row) => !row?.length)) {
    const error = new Error("Embeddings missing for one or more chunks");
    embedStage.error(error, {
      sourceId: input.sourceId,
      expected: chunks.length,
      received: embeddings.length,
    });
    throw error;
  }

  const dimensions = embeddings[0]?.length ?? 0;
  if (dimensions !== EMBEDDING_DIMENSIONS) {
    const error = new Error(
      `Unexpected embedding dimensions: ${dimensions} (expected ${EMBEDDING_DIMENSIONS})`
    );
    embedStage.error(error, { sourceId: input.sourceId, dimensions });
    throw error;
  }

  embedStage.completed({
    sourceId: input.sourceId,
    chunkCount: embeddings.length,
    embeddingDimensions: dimensions,
  });

  vectorStage.started({
    sourceId: input.sourceId,
    notebookId: input.notebookId,
    chunkCount: chunks.length,
  });

  try {
    await prisma.$executeRaw`
      DELETE FROM "DocumentChunk" WHERE "sourceId" = ${input.sourceId}
    `;

    for (let i = 0; i < chunks.length; i += 1) {
      const chunk = chunks[i]!;
      const embedding = embeddings[i]!;
      const id = createId();
      const vector = toVectorLiteral(embedding);

      await prisma.$executeRaw`
        INSERT INTO "DocumentChunk"
          ("id", "notebookId", "sourceId", "chunkIndex", "content", "embedding", "createdAt")
        VALUES (
          ${id},
          ${input.notebookId},
          ${input.sourceId},
          ${chunk.index},
          ${chunk.content},
          ${vector}::vector,
          NOW()
        )
      `;
    }

    const stored = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "DocumentChunk"
      WHERE "sourceId" = ${input.sourceId}
        AND "notebookId" = ${input.notebookId}
    `;
    const storedCount = Number(stored[0]?.count ?? 0);

    if (storedCount !== chunks.length) {
      throw new Error(
        `Vector persistence mismatch: stored ${storedCount}, expected ${chunks.length}`
      );
    }

    vectorStage.completed({
      sourceId: input.sourceId,
      notebookId: input.notebookId,
      storedCount,
      embeddingDimensions: dimensions,
    });
  } catch (error) {
    vectorStage.error(error, { sourceId: input.sourceId });
    throw error;
  }

  return {
    chunkCount: chunks.length,
    averageChunkSize,
    embeddingDimensions: dimensions,
    skipped: false,
  };
}

export async function notebookHasIndexedChunks(
  notebookId: string
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "DocumentChunk"
    WHERE "notebookId" = ${notebookId}
  `;
  return Number(rows[0]?.count ?? 0) > 0;
}

export async function countSourceChunks(sourceId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "DocumentChunk"
    WHERE "sourceId" = ${sourceId}
  `;
  return Number(rows[0]?.count ?? 0);
}

function indexableSourceText(
  extractedText: string | null | undefined
): string | null {
  if (!extractedText) return null;

  // Vision-fallback PDFs: only index accompanying extractable text, if any.
  if (extractedText.startsWith("SIRO_PDF_VISION:")) {
    const newline = extractedText.indexOf("\n");
    const remainder =
      newline === -1 ? "" : extractedText.slice(newline).trim();
    return remainder.length > 0 ? remainder : null;
  }

  const trimmed = extractedText.trim();
  return trimmed.length > 0 ? trimmed : null;
}

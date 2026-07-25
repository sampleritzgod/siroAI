import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { chunkText } from "@/modules/rag/chunk";
import {
  EMBEDDING_DIMENSIONS,
  embedTexts,
  toVectorLiteral,
} from "@/modules/rag/embed";
import { createId } from "@/modules/rag/ids";
import { stageLog } from "@/modules/rag/pipeline-log";

/**
 * Index (or re-index) an attachment's extracted text into DocumentChunk rows.
 * No-ops when there is nothing useful to embed (e.g. image-only PDFs).
 */
export async function indexAttachmentForRag(input: {
  attachmentId: string;
  conversationId: string;
  extractedText: string | null | undefined;
}): Promise<{ chunkCount: number; skipped: boolean }> {
  const chunkStage = stageLog("CHUNK");
  const embedStage = stageLog("EMBED");
  const vectorStage = stageLog("VECTOR");

  const text = indexableText(input.extractedText);
  if (!text) {
    chunkStage.started({
      attachmentId: input.attachmentId,
      conversationId: input.conversationId,
    });
    await prisma.$executeRaw`
      DELETE FROM "DocumentChunk" WHERE "attachmentId" = ${input.attachmentId}
    `;
    chunkStage.completed({
      attachmentId: input.attachmentId,
      chunkCount: 0,
      skipped: true,
    });
    return { chunkCount: 0, skipped: true };
  }

  chunkStage.started({
    attachmentId: input.attachmentId,
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
    attachmentId: input.attachmentId,
    chunkCount: chunks.length,
    averageChunkSize,
  });

  if (chunks.length === 0) {
    return { chunkCount: 0, skipped: true };
  }

  embedStage.started({
    attachmentId: input.attachmentId,
    chunkCount: chunks.length,
  });

  const embeddings = await embedTexts(chunks.map((chunk) => chunk.content));

  if (embeddings.length !== chunks.length) {
    const error = new Error("Embeddings missing for one or more chunks");
    embedStage.error(error, {
      attachmentId: input.attachmentId,
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
    embedStage.error(error, { attachmentId: input.attachmentId, dimensions });
    throw error;
  }

  embedStage.completed({
    attachmentId: input.attachmentId,
    chunkCount: embeddings.length,
    embeddingDimensions: dimensions,
  });

  vectorStage.started({
    attachmentId: input.attachmentId,
    conversationId: input.conversationId,
    chunkCount: chunks.length,
  });

  await prisma.$executeRaw`
    DELETE FROM "DocumentChunk" WHERE "attachmentId" = ${input.attachmentId}
  `;

  // Batch inserts — sequential per-chunk round trips blow past serverless limits.
  const INSERT_BATCH_SIZE = 30;
  for (let i = 0; i < chunks.length; i += INSERT_BATCH_SIZE) {
    const batch = chunks.slice(i, i + INSERT_BATCH_SIZE);
    const rows = batch.map((chunk, j) => {
      const embedding = embeddings[i + j];
      if (!embedding) {
        throw new Error(`Embeddings missing at chunk index ${i + j}`);
      }
      return Prisma.sql`(
        ${createId()},
        ${input.conversationId},
        ${input.attachmentId},
        ${chunk.index},
        ${chunk.content},
        ${toVectorLiteral(embedding)}::vector,
        NOW()
      )`;
    });

    await prisma.$executeRaw`
      INSERT INTO "DocumentChunk"
        ("id", "conversationId", "attachmentId", "chunkIndex", "content", "embedding", "createdAt")
      VALUES ${Prisma.join(rows)}
    `;
  }

  vectorStage.completed({
    attachmentId: input.attachmentId,
    conversationId: input.conversationId,
    storedCount: chunks.length,
  });

  return { chunkCount: chunks.length, skipped: false };
}

function indexableText(extractedText: string | null | undefined): string | null {
  if (!extractedText) return null;

  // Vision-fallback PDFs are handled as page images, not embeddings.
  if (extractedText.startsWith("SIRO_PDF_VISION:")) {
    return null;
  }

  const trimmed = extractedText.trim();
  if (trimmed.length < 40) return null;
  return trimmed;
}

export async function conversationHasIndexedChunks(
  conversationId: string
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "DocumentChunk"
    WHERE "conversationId" = ${conversationId}
  `;
  return Number(rows[0]?.count ?? 0) > 0;
}

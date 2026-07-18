import { prisma } from "@/lib/db";
import { chunkText } from "@/modules/rag/chunk";
import { embedTexts, toVectorLiteral } from "@/modules/rag/embed";
import { createId } from "@/modules/rag/ids";

/**
 * Index (or re-index) an attachment's extracted text into DocumentChunk rows.
 * No-ops when there is nothing useful to embed (e.g. image-only PDFs).
 */
export async function indexAttachmentForRag(input: {
  attachmentId: string;
  conversationId: string;
  extractedText: string | null | undefined;
}): Promise<{ chunkCount: number; skipped: boolean }> {
  const text = indexableText(input.extractedText);
  if (!text) {
    await prisma.$executeRaw`
      DELETE FROM "DocumentChunk" WHERE "attachmentId" = ${input.attachmentId}
    `;
    return { chunkCount: 0, skipped: true };
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return { chunkCount: 0, skipped: true };
  }

  const embeddings = await embedTexts(chunks.map((chunk) => chunk.content));

  await prisma.$executeRaw`
    DELETE FROM "DocumentChunk" WHERE "attachmentId" = ${input.attachmentId}
  `;

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    const embedding = embeddings[i];
    if (!embedding) continue;

    const id = createId();
    const vector = toVectorLiteral(embedding);

    await prisma.$executeRaw`
      INSERT INTO "DocumentChunk"
        ("id", "conversationId", "attachmentId", "chunkIndex", "content", "embedding", "createdAt")
      VALUES (
        ${id},
        ${input.conversationId},
        ${input.attachmentId},
        ${chunk.index},
        ${chunk.content},
        ${vector}::vector,
        NOW()
      )
    `;
  }

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

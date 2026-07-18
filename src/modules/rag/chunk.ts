export type TextChunk = {
  index: number;
  content: string;
};

const DEFAULT_CHUNK_SIZE = 900;
const DEFAULT_OVERLAP = 120;

/**
 * Simple character chunker with overlap — good enough for MVP RAG.
 */
export function chunkText(
  text: string,
  options?: { chunkSize?: number; overlap?: number }
): TextChunk[] {
  const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
  const overlap = options?.overlap ?? DEFAULT_OVERLAP;
  const normalized = text.replace(/\r\n/g, "\n").replace(/\u0000/g, "").trim();

  if (!normalized) return [];

  if (normalized.length <= chunkSize) {
    return [{ index: 0, content: normalized }];
  }

  const chunks: TextChunk[] = [];
  let start = 0;
  let index = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    // Prefer breaking on a paragraph / sentence boundary near the end.
    if (end < normalized.length) {
      const window = normalized.slice(start, end);
      const breakAt = Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
        window.lastIndexOf(". ")
      );
      if (breakAt > chunkSize * 0.4) {
        end = start + breakAt + 1;
      }
    }

    const content = normalized.slice(start, end).trim();
    if (content) {
      chunks.push({ index, content });
      index += 1;
    }

    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }

  return chunks;
}

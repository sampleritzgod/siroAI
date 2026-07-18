import { createOpenAI } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";

export const EMBEDDING_MODEL_ID = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

function getEmbeddingModel() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for document embeddings");
  }
  return createOpenAI({ apiKey }).embedding(EMBEDDING_MODEL_ID);
}

export async function embedQuery(text: string): Promise<number[]> {
  const { embedding } = await embed({
    model: getEmbeddingModel(),
    value: text,
  });
  return embedding;
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const { embeddings } = await embedMany({
    model: getEmbeddingModel(),
    values: texts,
  });

  return embeddings;
}

/** pgvector literal from a float array. */
export function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

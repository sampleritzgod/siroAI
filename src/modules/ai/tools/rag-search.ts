import { tool } from "ai";
import { z } from "zod";
import type { RagSearchToolResult } from "@/modules/ai/tools/rag-types";
import {
  formatRetrievedContext,
  retrieveRelevantChunks,
} from "@/modules/rag/retrieve";

export type {
  RagSearchFailure,
  RagSearchResultItem,
  RagSearchSuccess,
  RagSearchToolResult,
} from "@/modules/ai/tools/rag-types";
export { isRagSearchToolResult } from "@/modules/ai/tools/rag-types";

const ragSearchInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1)
    .max(300)
    .describe(
      "What to look up in uploaded conversation documents (keywords or a short question)."
    ),
  limit: z.number().int().min(1).max(8).optional(),
});

/**
 * Search indexed attachments in the current conversation (pgvector RAG).
 * Server-only — do not import from client components.
 */
export function createRagSearchTool(conversationId: string) {
  return tool({
    description: [
      "Search documents the user uploaded in this conversation.",
      "Use when the question is about an attached PDF, text file, or earlier uploaded material.",
      "Prefer this over guessing file contents. Cite returned sources by filename.",
    ].join(" "),
    inputSchema: ragSearchInputSchema,
    execute: async ({ query, limit }): Promise<RagSearchToolResult> => {
      const parsed = ragSearchInputSchema.safeParse({ query, limit });
      if (!parsed.success) {
        return {
          ok: false,
          query: typeof query === "string" ? query : "",
          code: "INVALID_INPUT",
          error: parsed.error.issues[0]?.message ?? "Invalid input",
        };
      }

      try {
        const chunks = await retrieveRelevantChunks({
          conversationId,
          query: parsed.data.query,
          limit: parsed.data.limit ?? 6,
        });

        if (chunks.length === 0) {
          return {
            ok: false,
            query: parsed.data.query,
            code: "NO_RESULTS",
            error:
              "No indexed document chunks matched. The file may still be indexing, or it has no extractable text.",
          };
        }

        return {
          ok: true,
          query: parsed.data.query,
          results: chunks.map((chunk) => ({
            attachmentId: chunk.attachmentId,
            filename: chunk.filename,
            chunkIndex: chunk.chunkIndex,
            snippet: chunk.content.slice(0, 280),
            score: chunk.score,
          })),
          context: formatRetrievedContext(chunks),
        };
      } catch (error) {
        return {
          ok: false,
          query: parsed.data.query,
          code: "PROVIDER_ERROR",
          error:
            error instanceof Error ? error.message : "Document search failed",
        };
      }
    },
  });
}

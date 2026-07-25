import { tool } from "ai";
import { z } from "zod";
import type { RagSearchToolResult } from "@/modules/ai/tools/rag-types";
import { notebookHasIndexedChunks } from "@/modules/rag/index-source";
import { conversationHasIndexedChunks } from "@/modules/rag/index-attachment";
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
      "What to look up in notebook sources or uploaded conversation documents (keywords or a short question)."
    ),
  limit: z.number().int().min(1).max(8).optional(),
});

/**
 * Search indexed notebook sources + conversation attachments (pgvector RAG).
 * Server-only — do not import from client components.
 */
export function createRagSearchTool(input: {
  conversationId: string;
  notebookId: string;
}) {
  return tool({
    description: [
      "Search documents in this notebook and any files uploaded in this conversation.",
      "Use when the question is about notebook sources, attached PDFs, or earlier uploaded material.",
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
        const hasNotebookChunks = await notebookHasIndexedChunks(
          input.notebookId
        );
        const hasAttachmentChunks = await conversationHasIndexedChunks(
          input.conversationId
        );

        if (!hasNotebookChunks && !hasAttachmentChunks) {
          return {
            ok: false,
            query: parsed.data.query,
            code: "NOT_INDEXED",
            error:
              "No indexed sources found. Upload and index at least one notebook source.",
          };
        }

        const chunks = await retrieveRelevantChunks({
          conversationId: input.conversationId,
          notebookId: input.notebookId,
          query: parsed.data.query,
          limit: parsed.data.limit ?? 6,
        });

        if (chunks.length === 0) {
          return {
            ok: false,
            query: parsed.data.query,
            code: "NO_RESULTS",
            error:
              "Retrieval returned zero chunks. The information may not be present in the notebook sources.",
          };
        }

        return {
          ok: true,
          query: parsed.data.query,
          results: chunks.map((chunk) => ({
            attachmentId: chunk.attachmentId,
            sourceId: chunk.sourceId,
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

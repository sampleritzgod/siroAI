import { tool } from "ai";
import { z } from "zod";
import { searchWithTavily } from "./providers/tavily";
import {
  WEB_SEARCH_MAX_QUERY_LENGTH,
  WEB_SEARCH_MAX_RESULTS,
  type WebSearchToolResult,
} from "./types";

const webSearchInputSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Query is required")
    .max(
      WEB_SEARCH_MAX_QUERY_LENGTH,
      `Query must be at most ${WEB_SEARCH_MAX_QUERY_LENGTH} characters`
    )
    .describe(
      "Focused search query. Prefer concrete entities, dates, and keywords over full sentences."
    ),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(WEB_SEARCH_MAX_RESULTS)
    .optional()
    .describe(`Number of results to return (1–${WEB_SEARCH_MAX_RESULTS}).`),
});

/**
 * LLM-callable web search tool.
 * Failures return a structured result (not a thrown error) so generation can continue.
 */
export const webSearchTool = tool({
  description: [
    "Search the live web for current information.",
    "Use for news, prices, sports scores, recent events, or facts that may have changed.",
    "Do NOT use for pure reasoning, coding help, or information already present in the chat.",
    "Prefer a single focused query; avoid duplicate searches for the same question.",
  ].join(" "),
  inputSchema: webSearchInputSchema,
  execute: async (
    { query, maxResults },
    { abortSignal }
  ): Promise<WebSearchToolResult> => {
    const parsed = webSearchInputSchema.safeParse({ query, maxResults });

    if (!parsed.success) {
      return {
        ok: false,
        query: typeof query === "string" ? query : "",
        provider: "tavily",
        code: "INVALID_INPUT",
        error: parsed.error.issues[0]?.message ?? "Invalid search input",
      };
    }

    return searchWithTavily({
      query: parsed.data.query,
      maxResults: parsed.data.maxResults ?? WEB_SEARCH_MAX_RESULTS,
      signal: abortSignal,
    });
  },
});

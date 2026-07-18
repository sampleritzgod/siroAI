import { createRagSearchTool } from "./rag-search";
import { webSearchTool } from "./web-search";

/**
 * Server-only chat tool registry (includes DB-backed ragSearch).
 * Client UI must import types from `./types` or `./rag-types`, not this barrel.
 */
export function createChatTools(input: { conversationId: string }) {
  return {
    webSearch: webSearchTool,
    ragSearch: createRagSearchTool(input.conversationId),
  };
}

export type ChatTools = ReturnType<typeof createChatTools>;

export { webSearchTool } from "./web-search";
export { createRagSearchTool } from "./rag-search";
export { hasTavilyApiKey } from "./providers/tavily";
export type {
  WebSearchFailure,
  WebSearchResultItem,
  WebSearchSuccess,
  WebSearchToolResult,
} from "./types";
export { isWebSearchToolResult } from "./types";
export type {
  RagSearchFailure,
  RagSearchResultItem,
  RagSearchSuccess,
  RagSearchToolResult,
} from "./rag-types";
export { isRagSearchToolResult } from "./rag-types";

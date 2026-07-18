/**
 * Client-safe RAG tool contracts (no DB / Node imports).
 */

export type RagSearchResultItem = {
  attachmentId: string;
  filename: string;
  chunkIndex: number;
  snippet: string;
  score: number;
};

export type RagSearchSuccess = {
  ok: true;
  query: string;
  results: RagSearchResultItem[];
  context: string;
};

export type RagSearchFailure = {
  ok: false;
  query: string;
  error: string;
  code: "INVALID_INPUT" | "NO_RESULTS" | "NOT_INDEXED" | "PROVIDER_ERROR";
};

export type RagSearchToolResult = RagSearchSuccess | RagSearchFailure;

export function isRagSearchToolResult(
  value: unknown
): value is RagSearchToolResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as { ok: unknown }).ok === "boolean" &&
    "query" in value
  );
}

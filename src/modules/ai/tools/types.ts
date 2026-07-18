/**
 * Normalized web-search contracts used by the tool, provider, and UI.
 */

export type WebSearchResultItem = {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
};

export type WebSearchSuccess = {
  ok: true;
  query: string;
  provider: string;
  results: WebSearchResultItem[];
};

export type WebSearchFailure = {
  ok: false;
  query: string;
  provider: string;
  error: string;
  code:
    | "NOT_CONFIGURED"
    | "INVALID_INPUT"
    | "TIMEOUT"
    | "PROVIDER_ERROR"
    | "NO_RESULTS"
    | "ABORTED";
};

export type WebSearchToolResult = WebSearchSuccess | WebSearchFailure;

export const WEB_SEARCH_TIMEOUT_MS = 10_000;
export const WEB_SEARCH_MAX_RESULTS = 5;
export const WEB_SEARCH_MAX_QUERY_LENGTH = 200;

export function isWebSearchToolResult(
  value: unknown
): value is WebSearchToolResult {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    typeof (value as { ok: unknown }).ok === "boolean" &&
    "query" in value
  );
}

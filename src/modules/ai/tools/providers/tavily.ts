import type { WebSearchResultItem, WebSearchToolResult } from "../types";
import { WEB_SEARCH_MAX_RESULTS, WEB_SEARCH_TIMEOUT_MS } from "../types";

type TavilySearchOptions = {
  query: string;
  maxResults?: number;
  signal?: AbortSignal;
};

type TavilyApiResponse = {
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
    published_date?: string;
  }>;
  detail?: { error?: string } | string;
  error?: string;
};

export function hasTavilyApiKey() {
  return Boolean(process.env.TAVILY_API_KEY?.trim());
}

/**
 * Calls the Tavily Search API and normalizes hits for the LLM + UI.
 * Failures return structured results (never throw) so generation can continue.
 */
export async function searchWithTavily({
  query,
  maxResults = WEB_SEARCH_MAX_RESULTS,
  signal,
}: TavilySearchOptions): Promise<WebSearchToolResult> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();

  if (!apiKey) {
    return {
      ok: false,
      query,
      provider: "tavily",
      code: "NOT_CONFIGURED",
      error: "Web search is not configured. Set TAVILY_API_KEY on the server.",
    };
  }

  const timeout = AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS);
  const combined =
    signal != null ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        include_answer: false,
        include_images: false,
        max_results: maxResults,
      }),
      signal: combined,
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | TavilyApiResponse
        | null;
      const detail =
        typeof body?.detail === "string"
          ? body.detail
          : body?.detail && typeof body.detail === "object"
            ? body.detail.error
            : body?.error;

      return {
        ok: false,
        query,
        provider: "tavily",
        code: "PROVIDER_ERROR",
        error: detail || `Tavily request failed (${response.status})`,
      };
    }

    const data = (await response.json()) as TavilyApiResponse;
    const results: WebSearchResultItem[] = (data.results ?? [])
      .map((item) => ({
        title: item.title?.trim() || "Untitled",
        url: item.url?.trim() || "",
        snippet: item.content?.trim() || "",
        publishedAt: item.published_date,
      }))
      .filter((item) => item.url.length > 0)
      .slice(0, maxResults);

    if (results.length === 0) {
      return {
        ok: false,
        query,
        provider: "tavily",
        code: "NO_RESULTS",
        error: "No web results were found for that query.",
      };
    }

    return {
      ok: true,
      query,
      provider: "tavily",
      results,
    };
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return {
        ok: false,
        query,
        provider: "tavily",
        code: "ABORTED",
        error: "Web search was cancelled.",
      };
    }

    if (error instanceof Error && error.name === "TimeoutError") {
      return {
        ok: false,
        query,
        provider: "tavily",
        code: "TIMEOUT",
        error: `Web search timed out after ${WEB_SEARCH_TIMEOUT_MS / 1000}s.`,
      };
    }

    return {
      ok: false,
      query,
      provider: "tavily",
      code: "PROVIDER_ERROR",
      error:
        error instanceof Error ? error.message : "Unknown web search error",
    };
  }
}

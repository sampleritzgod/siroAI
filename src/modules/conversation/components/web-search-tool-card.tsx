"use client";

import { isToolUIPart, type UIMessage } from "ai";
import { cn } from "@/lib/utils";
import {
  isWebSearchToolResult,
  type WebSearchToolResult,
} from "@/modules/ai/tools/types";

type ToolPart = Extract<
  UIMessage["parts"][number],
  { type: string; toolCallId: string }
>;

type WebSearchToolCardProps = {
  part: ToolPart;
  settlePending?: boolean;
};

function getQuery(part: ToolPart): string {
  const input = "input" in part ? part.input : undefined;
  if (
    input &&
    typeof input === "object" &&
    "query" in input &&
    typeof (input as { query: unknown }).query === "string"
  ) {
    return (input as { query: string }).query;
  }
  return "";
}

function getOutput(part: ToolPart): WebSearchToolResult | null {
  if (!("output" in part) || part.output == null) return null;
  return isWebSearchToolResult(part.output) ? part.output : null;
}

export function WebSearchToolCard({
  part,
  settlePending = false,
}: WebSearchToolCardProps) {
  if (!isToolUIPart(part)) return null;

  const query = getQuery(part);
  const state = part.state;
  const output = getOutput(part);
  const errorText =
    state === "output-error" && "errorText" in part ? part.errorText : undefined;

  const wasInFlight =
    state === "input-streaming" ||
    state === "input-available" ||
    state === "approval-requested" ||
    state === "approval-responded";

  const isPending = wasInFlight && !settlePending;

  const failed =
    state === "output-error" ||
    state === "output-denied" ||
    (output != null && output.ok === false) ||
    (settlePending && wasInFlight);

  return (
    <div className="w-full max-w-xl rounded-2xl border border-[var(--border)] bg-[var(--sidebar)] px-3.5 py-3 text-sm">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 text-[var(--muted)]">
          {isPending ? "…" : failed ? "!" : "✓"}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-[13px] font-medium">
            {isPending
              ? "Searching the web…"
              : failed
                ? "Web search failed"
                : "Web search complete"}
          </p>

          {query ? (
            <p className="truncate text-xs text-[var(--muted)]">
              Query: {query}
            </p>
          ) : null}

          {failed ? (
            <p className="text-xs text-red-600">
              {output && !output.ok
                ? output.error
                : errorText || "Search did not finish."}
            </p>
          ) : null}

          {output?.ok ? (
            <ul className="space-y-1.5 pt-1">
              {output.results.slice(0, 3).map((result) => (
                <li key={result.url} className="min-w-0">
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "block truncate text-xs font-medium text-[var(--accent)] hover:underline"
                    )}
                  >
                    {result.title}
                  </a>
                  {result.snippet ? (
                    <p className="line-clamp-2 text-[11px] text-[var(--muted)]">
                      {result.snippet}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

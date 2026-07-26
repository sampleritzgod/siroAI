"use client";

import type { UIMessage } from "ai";
import { cn } from "@/lib/utils";
import {
  isRagSearchToolResult,
  type RagSearchToolResult,
} from "@/modules/ai/tools/rag-types";
import { useSourceViewer } from "@/modules/conversation/components/source-viewer-provider";

type ToolPart = Extract<
  UIMessage["parts"][number],
  { type: string; toolCallId: string }
>;

type RagSearchToolCardProps = {
  part: ToolPart;
  settlePending?: boolean;
};

function getOutput(part: ToolPart): RagSearchToolResult | null {
  if (!("output" in part) || part.output == null) return null;
  return isRagSearchToolResult(part.output) ? part.output : null;
}

export function RagSearchToolCard({
  part,
  settlePending = false,
}: RagSearchToolCardProps) {
  const viewer = useSourceViewer();
  const pending =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    (settlePending === false && part.state === "output-available");

  const result = getOutput(part);

  return (
    <div className="w-full max-w-[92%] rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-xs sm:max-w-[85%]">
      <div className="mb-1.5 flex items-center gap-2 font-medium text-[var(--foreground)]">
        <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--accent)]">
          Docs
        </span>
        <span className="truncate text-[var(--muted)]">
          {pending && !result
            ? "Searching uploaded documents…"
            : result?.ok
              ? `Found ${result.results.length} passage${result.results.length === 1 ? "" : "s"}`
              : "Document search"}
        </span>
      </div>

      {result?.ok ? (
        <ul className="flex flex-col gap-1.5">
          {result.results.map((item, index) => {
            const canOpen =
              Boolean(viewer) && Boolean(item.sourceId || item.attachmentId);

            const body = (
              <>
                <div className="flex items-baseline gap-1.5">
                  <span className="font-medium text-[var(--accent)]">
                    [{index + 1}]
                  </span>
                  <span className="truncate font-medium text-[var(--foreground)]">
                    {item.filename}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--muted)]">
                    chunk {item.chunkIndex + 1}
                    {typeof item.score === "number"
                      ? ` · score ${item.score.toFixed(2)}`
                      : ""}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-3 text-left text-[var(--muted)]">
                  {item.snippet}
                </p>
              </>
            );

            return (
              <li
                key={`${item.sourceId ?? item.attachmentId ?? "doc"}-${item.chunkIndex}-${index}`}
              >
                {canOpen ? (
                  <button
                    type="button"
                    onClick={() =>
                      viewer?.openTarget({
                        sourceId: item.sourceId,
                        attachmentId: item.attachmentId,
                        chunkIndex: item.chunkIndex,
                        page: null,
                        fallbackTitle: item.filename,
                      })
                    }
                    className="w-full rounded-lg bg-[var(--background)]/60 px-2 py-1.5 text-left transition-colors hover:bg-[var(--background)] hover:ring-1 hover:ring-[var(--accent)]"
                  >
                    {body}
                  </button>
                ) : (
                  <div className="rounded-lg bg-[var(--background)]/60 px-2 py-1.5">
                    {body}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {result && !result.ok ? (
        <p className={cn("text-[var(--muted)]")}>{result.error}</p>
      ) : null}
    </div>
  );
}

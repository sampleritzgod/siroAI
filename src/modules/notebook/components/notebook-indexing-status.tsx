"use client";

import type { SourceListItem } from "@/modules/source/service";

const STEPS = [
  "Processing…",
  "Extracting text…",
  "Creating embeddings…",
  "Indexing…",
] as const;

type NotebookIndexingStatusProps = {
  sources: SourceListItem[];
};

export function NotebookIndexingStatus({
  sources,
}: NotebookIndexingStatusProps) {
  const active =
    sources.find((source) => source.indexingStatus === "PROCESSING") ??
    sources.find((source) => source.indexingStatus === "PENDING") ??
    sources[0];

  const failed = sources.every((source) => source.indexingStatus === "FAILED");

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-[var(--background)] px-6 py-10">
      <div className="w-full max-w-sm text-center">
        <h2 className="text-xl font-semibold tracking-tight">
          {failed ? "Indexing failed" : "Preparing your notebook"}
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          {failed
            ? "Something went wrong while indexing. Try adding the source again."
            : active
              ? `Working on “${active.title}”`
              : "Working on your sources"}
        </p>

        {!failed ? (
          <ol className="mt-8 space-y-3 text-left">
            {STEPS.map((step, index) => (
              <li
                key={step}
                className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm"
              >
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-xs font-medium text-[var(--accent)]"
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        ) : null}

        <p className="mt-6 text-xs text-[var(--muted)]">
          Chat unlocks when at least one source finishes indexing.
        </p>
      </div>
    </div>
  );
}

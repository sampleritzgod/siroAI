"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { SourceListItem } from "@/modules/source/service";

const STEPS = [
  "Processing…",
  "Extracting text…",
  "Creating embeddings…",
  "Indexing…",
] as const;

type NotebookIndexingStatusProps = {
  sources: SourceListItem[];
  onRefresh?: () => void;
};

export function NotebookIndexingStatus({
  sources,
  onRefresh,
}: NotebookIndexingStatusProps) {
  const active =
    sources.find((source) => source.indexingStatus === "PROCESSING") ??
    sources.find((source) => source.indexingStatus === "PENDING") ??
    sources[0];

  const failed = sources.every((source) => source.indexingStatus === "FAILED");

  if (failed) {
    return (
      <IndexingShell
        failed
        title="Indexing failed"
        description="Something went wrong while indexing. Try adding the source again."
      >
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            className="mt-4 text-sm font-medium text-[var(--accent)] hover:underline"
          >
            Try again
          </button>
        ) : null}
      </IndexingShell>
    );
  }

  return (
    <IndexingProgress
      key={active?.id ?? "indexing"}
      activeTitle={active?.title ?? null}
      onRefresh={onRefresh}
    />
  );
}

function IndexingShell({
  failed,
  title,
  description,
  children,
}: {
  failed?: boolean;
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col items-center justify-center overflow-y-auto overscroll-contain px-6 py-10">
      <div className="w-full max-w-sm shrink-0 text-center">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[var(--accent)]/10">
          {failed ? (
            <span className="text-lg text-red-500" aria-hidden="true">
              !
            </span>
          ) : (
            <span
              className="size-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
              aria-hidden="true"
            />
          )}
        </div>

        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">{description}</p>
        {children}
        <p className="mt-6 text-xs text-[var(--muted)]">
          Chat unlocks when at least one source finishes indexing.
        </p>
      </div>
    </div>
  );
}

function IndexingProgress({
  activeTitle,
  onRefresh,
}: {
  activeTitle: string | null;
  onRefresh?: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    const stepTimers = [
      window.setTimeout(() => setStepIndex(1), 700),
      window.setTimeout(() => setStepIndex(2), 1600),
      window.setTimeout(() => setStepIndex(3), 2800),
    ];
    const tick = window.setInterval(() => {
      setElapsedSec((value) => value + 1);
    }, 1000);

    return () => {
      for (const timer of stepTimers) window.clearTimeout(timer);
      window.clearInterval(tick);
    };
  }, []);

  return (
    <IndexingShell
      title="Preparing your notebook"
      description={
        activeTitle ? `Working on “${activeTitle}”` : "Working on your sources"
      }
    >
      <p className="mt-1 text-xs text-[var(--muted)]">
        {elapsedSec < 1
          ? "Starting embeddings…"
          : `${elapsedSec}s · usually finishes in under a minute`}
      </p>

      <ol className="mt-8 space-y-3 text-left" aria-live="polite">
        {STEPS.map((step, index) => {
          const done = index < stepIndex;
          const current = index === stepIndex;
          return (
            <li
              key={step}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm",
                current
                  ? "border-[var(--accent)]/40 bg-[var(--accent)]/5 text-[var(--foreground)]"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  done || current
                    ? "bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "bg-[var(--sidebar)] text-[var(--muted)]"
                )}
                aria-hidden="true"
              >
                {done ? "✓" : index + 1}
              </span>
              <span className={cn(current && "font-medium")}>{step}</span>
              {current ? (
                <span
                  className="ml-auto size-3.5 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
                  aria-hidden="true"
                />
              ) : null}
            </li>
          );
        })}
      </ol>

      {elapsedSec >= 45 && onRefresh ? (
        <button
          type="button"
          onClick={onRefresh}
          className="mt-6 text-sm font-medium text-[var(--accent)] hover:underline"
        >
          Taking longer than usual — refresh status
        </button>
      ) : null}
    </IndexingShell>
  );
}

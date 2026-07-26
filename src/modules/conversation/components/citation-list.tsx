"use client";

import { useSourceViewer } from "@/modules/conversation/components/source-viewer-provider";
import type { MessageCitation } from "@/modules/rag/citation-types";
import { SOURCE_TYPE_LABELS } from "@/modules/source/components/source-viewer-dialog";

/**
 * "Sources" footer under an assistant answer: filename, type, chunk number and
 * retrieval score for every citation the turn was grounded in.
 */
export function CitationList({ citations }: { citations: MessageCitation[] }) {
  const viewer = useSourceViewer();

  if (citations.length === 0) return null;

  return (
    <div className="mt-1.5 w-full max-w-[92%] sm:max-w-[85%]">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
        Sources
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {citations.map((citation) => {
          const label = `${citation.index}. ${citation.filename}`;
          const meta = [
            SOURCE_TYPE_LABELS[citation.sourceType] ?? citation.sourceType,
            `chunk ${citation.chunkIndex + 1}`,
            Number.isFinite(citation.score)
              ? `score ${citation.score.toFixed(2)}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ");

          if (!viewer) {
            return (
              <li
                key={citation.chunkId}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--muted)]"
              >
                <span className="font-medium text-[var(--foreground)]">
                  {label}
                </span>{" "}
                <span>{meta}</span>
              </li>
            );
          }

          return (
            <li key={citation.chunkId}>
              <button
                type="button"
                onClick={() => viewer.openCitation(citation)}
                title={citation.snippet}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-left text-[11px] text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--foreground)]"
              >
                <span className="font-medium text-[var(--foreground)]">
                  {label}
                </span>{" "}
                <span>{meta}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

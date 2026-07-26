"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { MessageCitation } from "@/modules/rag/citation-types";
import {
  getSourceViewerData,
  type SourceViewerData,
} from "@/modules/source/actions/source-viewer-actions";

export type SourceViewerTarget = {
  sourceId: string | null;
  attachmentId: string | null;
  chunkIndex: number | null;
  page: number | null;
  /** Shown in the header before the payload arrives. */
  fallbackTitle?: string;
  citation?: MessageCitation | null;
};

type SourceViewerDialogProps = {
  target: SourceViewerTarget | null;
  onClose: () => void;
};

const TYPE_LABELS: Record<string, string> = {
  PDF: "PDF",
  TEXT: "Text",
  VTT: "Subtitles",
  WEBSITE: "Website",
  YOUTUBE: "YouTube",
  ATTACHMENT: "Attachment",
};

export function SourceViewerDialog({
  target,
  onClose,
}: SourceViewerDialogProps) {
  if (!target) return null;

  // Keyed so opening another citation starts from a clean loading state.
  return (
    <SourceViewerModal
      key={`${target.sourceId ?? target.attachmentId ?? "source"}:${target.chunkIndex ?? "all"}`}
      target={target}
      onClose={onClose}
    />
  );
}

function SourceViewerModal({
  target,
  onClose,
}: SourceViewerDialogProps & { target: SourceViewerTarget }) {
  const titleId = useId();
  const [data, setData] = useState<SourceViewerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const result = await getSourceViewerData({
          sourceId: target.sourceId,
          attachmentId: target.attachmentId,
          chunkIndex: target.chunkIndex,
        });
        if (cancelled) return;
        if (!result) {
          setData(null);
          setError("This source is no longer available.");
          return;
        }
        setData(result);
      } catch {
        if (cancelled) return;
        setData(null);
        setError("Could not open this source. Try again.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [target, reloadKey]);

  function retry() {
    setLoading(true);
    setError(null);
    setReloadKey((value) => value + 1);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const headerTitle = data?.title ?? target.fallbackTitle ?? "Source";
  const typeLabel = data ? (TYPE_LABELS[data.type] ?? data.type) : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        aria-label="Close source viewer"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[71] flex h-full max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl"
      >
        <header className="flex items-start gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              {typeLabel ? (
                <span className="rounded bg-[var(--accent)]/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--accent)]">
                  {typeLabel}
                </span>
              ) : null}
              <h2
                id={titleId}
                className="truncate text-sm font-semibold tracking-tight"
              >
                {headerTitle}
              </h2>
            </div>
            <p className="mt-0.5 truncate text-xs text-[var(--muted)]">
              {describeSubtitle(data, target)}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {data?.url ? (
              <a
                href={data.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                {data.type === "YOUTUBE"
                  ? "Open on YouTube"
                  : "Open Original Website"}
              </a>
            ) : null}
            {data?.fileUrl ? (
              <a
                href={data.fileUrl}
                download={data.originalFileName}
                className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:border-[var(--accent)] hover:text-[var(--accent)]"
              >
                Download
              </a>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--sidebar)]"
            >
              Close
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden">
          {loading && !data ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-[var(--muted)]">
              <span
                className="size-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
                aria-hidden="true"
              />
              Loading source…
            </div>
          ) : null}

          {error && !data ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-[var(--muted)]" role="alert">
                {error}
              </p>
              <button
                type="button"
                onClick={retry}
                className="text-sm font-medium text-[var(--accent)] hover:underline"
              >
                Try again
              </button>
            </div>
          ) : null}

          {data ? <ViewerBody data={data} page={target.page} /> : null}
        </div>
      </div>
    </div>
  );
}

function ViewerBody({
  data,
  page,
}: {
  data: SourceViewerData;
  page: number | null;
}) {
  const isPdf = data.mimeType === "application/pdf";

  if (isPdf && data.fileUrl) {
    // Page anchors are honoured by the browser's built-in PDF viewer; without a
    // known page the document simply opens at the beginning.
    const src = `${data.fileUrl}#page=${page && page > 0 ? page : 1}`;
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-[var(--border)] px-4 py-1.5 text-xs text-[var(--muted)]">
          {page && page > 0 ? `Cited page ${page}` : "Opened from page 1"}
        </div>
        <iframe
          key={src}
          src={src}
          title={data.title}
          className="min-h-0 flex-1 bg-[var(--background)]"
        />
      </div>
    );
  }

  if (data.type === "YOUTUBE") {
    return (
      <TextPane
        data={data}
        emptyLabel="No transcript was stored for this video."
        label="Transcript"
      />
    );
  }

  if (data.type === "WEBSITE") {
    return (
      <TextPane
        data={data}
        emptyLabel="No extracted text was stored for this page."
        label="Extracted text"
      />
    );
  }

  return (
    <TextPane
      data={data}
      emptyLabel="No text content was extracted from this source."
      label={data.type === "VTT" ? "Transcript" : "Text content"}
    />
  );
}

/**
 * Renders stored text and scrolls the cited chunk into view, highlighting it
 * when the chunk can be located inside the extracted text.
 */
function TextPane({
  data,
  label,
  emptyLabel,
}: {
  data: SourceViewerData;
  label: string;
  emptyLabel: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const markRef = useRef<HTMLElement | null>(null);
  const segments = splitAroundChunk(data.text, data.chunkText);

  useLayoutEffect(() => {
    const mark = markRef.current;
    const scroller = scrollRef.current;
    if (!mark || !scroller) return;
    scroller.scrollTop = Math.max(0, mark.offsetTop - scroller.clientHeight / 3);
  }, [data.id, data.chunkIndex, data.text]);

  if (!data.text) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-[var(--muted)]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-1.5 text-xs text-[var(--muted)]">
        <span>{label}</span>
        {segments.matched ? (
          <span className="text-[var(--accent)]">Cited passage highlighted</span>
        ) : null}
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
      >
        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--foreground)]">
          {segments.matched ? (
            <>
              {segments.before}
              <mark
                ref={markRef}
                className="rounded bg-[var(--accent)]/25 px-0.5 text-[var(--foreground)]"
              >
                {segments.match}
              </mark>
              {segments.after}
            </>
          ) : (
            data.text
          )}
        </p>
        {data.textTruncated ? (
          <p className="mt-3 text-xs italic text-[var(--muted)]">
            Preview truncated. Download the source for the full content.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Locate the cited chunk inside the full text so it can be highlighted. */
function splitAroundChunk(
  text: string | null,
  chunkText: string | null
): {
  matched: boolean;
  before: string;
  match: string;
  after: string;
} {
  const empty = { matched: false, before: "", match: "", after: "" };
  if (!text || !chunkText) return empty;

  const needle = chunkText.trim();
  if (needle.length < 12) return empty;

  let start = text.indexOf(needle);
  let length = needle.length;

  if (start === -1) {
    // Chunking may normalise whitespace — fall back to a distinctive prefix.
    const prefix = needle.slice(0, 60);
    start = text.indexOf(prefix);
    length = prefix.length;
  }

  if (start === -1) return empty;

  return {
    matched: true,
    before: text.slice(0, start),
    match: text.slice(start, start + length),
    after: text.slice(start + length),
  };
}

function describeSubtitle(
  data: SourceViewerData | null,
  target: SourceViewerTarget
): string {
  const parts: string[] = [];

  if (data) {
    if (data.type === "WEBSITE" || data.type === "YOUTUBE") {
      if (data.url) parts.push(data.url);
    } else {
      parts.push(data.originalFileName);
    }
  } else if (target.fallbackTitle) {
    parts.push(target.fallbackTitle);
  }

  const chunkIndex = data?.chunkIndex ?? target.chunkIndex;
  if (chunkIndex != null) parts.push(`chunk ${chunkIndex + 1}`);
  if (target.citation) parts.push(`score ${target.citation.score.toFixed(2)}`);
  if (data?.metadata?.durationSeconds != null) {
    parts.push(formatDuration(data.metadata.durationSeconds));
  }

  return parts.filter(Boolean).join(" · ");
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export { TYPE_LABELS as SOURCE_TYPE_LABELS };

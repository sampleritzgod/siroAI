"use client";

import { useEffect, useId } from "react";
import type { SourceListItem } from "@/modules/source/service";
import { formatIndexingStatus } from "@/modules/source/status-label";

type SourceMetadataDialogProps = {
  source: SourceListItem | null;
  onClose: () => void;
};

export function SourceMetadataDialog({
  source,
  onClose,
}: SourceMetadataDialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!source) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [source, onClose]);

  if (!source) return null;

  const rows: { label: string; value: string }[] = [
    { label: "Title", value: source.title },
    { label: "Type", value: source.type },
    {
      label:
        source.type === "WEBSITE"
          ? "Host"
          : source.type === "YOUTUBE"
            ? "Channel"
            : "File name",
      value: source.originalFileName,
    },
    ...(source.url ? [{ label: "URL", value: source.url }] : []),
    ...(source.metadata?.thumbnailUrl
      ? [{ label: "Thumbnail", value: source.metadata.thumbnailUrl }]
      : []),
    ...(source.metadata?.durationSeconds != null
      ? [
          {
            label: "Duration",
            value: formatDuration(source.metadata.durationSeconds),
          },
        ]
      : []),
    ...(source.metadata?.cueCount != null
      ? [{ label: "Cues", value: String(source.metadata.cueCount) }]
      : []),
    ...(source.metadata?.language
      ? [{ label: "Language", value: source.metadata.language }]
      : []),
    { label: "MIME type", value: source.mimeType },
    { label: "Size", value: formatBytes(source.fileSize) },
    { label: "Status", value: formatIndexingStatus(source.indexingStatus) },
    {
      label: "Extracted text",
      value: source.hasExtractedText ? "Yes" : "No",
    },
    {
      label: "Created",
      value: formatDate(source.createdAt),
    },
    {
      label: "Updated",
      value: formatDate(source.updatedAt),
    },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[61] w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          Source details
        </h2>

        <dl className="mt-4 flex flex-col gap-2 text-sm">
          {rows.map((row) => (
            <div key={row.label} className="flex gap-3">
              <dt className="w-28 shrink-0 text-[var(--muted)]">{row.label}</dt>
              <dd className="min-w-0 flex-1 break-words font-medium">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--sidebar)]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

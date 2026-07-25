"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  MAX_UPLOAD_BYTES,
  SOURCE_ALLOWED_MEDIA_TYPES,
  resolveSourceMediaType,
} from "@/modules/source/constants";

const UPLOAD_STEPS = [
  "Uploading file…",
  "Storing file…",
  "Extracting text…",
  "Queuing indexing…",
] as const;

type AddSourceDialogProps = {
  open: boolean;
  notebookId: string | null;
  onClose: () => void;
  onUploaded: () => void;
};

export function AddSourceDialog({
  open,
  notebookId,
  onClose,
  onUploaded,
}: AddSourceDialogProps) {
  if (!open || !notebookId) return null;

  return (
    <AddSourceDialogForm
      key={notebookId}
      notebookId={notebookId}
      onClose={onClose}
      onUploaded={onUploaded}
    />
  );
}

function AddSourceDialogForm({
  notebookId,
  onClose,
  onUploaded,
}: {
  notebookId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const titleId = useId();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isUploading) {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isUploading, onClose]);

  useEffect(() => {
    if (!isUploading) {
      setStepIndex(0);
      setElapsedSec(0);
      return;
    }

    setStepIndex(0);
    const stepTimers = [
      window.setTimeout(() => setStepIndex(1), 400),
      window.setTimeout(() => setStepIndex(2), 900),
      window.setTimeout(() => setStepIndex(3), 1600),
    ];
    const tick = window.setInterval(() => {
      setElapsedSec((value) => value + 1);
    }, 1000);

    return () => {
      for (const timer of stepTimers) window.clearTimeout(timer);
      window.clearInterval(tick);
    };
  }, [isUploading]);

  function validateFile(file: File): string | null {
    if (!file.size) {
      return "File is empty.";
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return `File too large. Maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`;
    }
    const mediaType = resolveSourceMediaType({
      filename: file.name,
      fileType: file.type,
    });
    if (!mediaType) {
      return "Unsupported file type. Only PDF and plain text are allowed.";
    }
    return null;
  }

  async function uploadFile(file: File | undefined) {
    if (!file || isUploading) return;

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!notebookId.trim()) {
      setError("Notebook not found");
      return;
    }

    setError(null);
    setFileName(file.name);
    setIsUploading(true);

    try {
      const form = new FormData();
      form.set("notebookId", notebookId);
      form.set("file", file);

      const response = await fetch("/api/sources", {
        method: "POST",
        body: form,
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) {
        if (response.status === 401) {
          setError("Unauthorized");
          return;
        }
        if (response.status === 404) {
          setError(payload?.error || "Notebook not found");
          return;
        }
        setError(
          payload?.error ||
            (response.status === 413
              ? `File too large. Maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`
              : response.status === 415
                ? "Unsupported file type. Only PDF and plain text are allowed."
                : response.status === 422
                  ? "PDF extraction failed"
                  : "Unexpected server error")
        );
        return;
      }

      onUploaded();
      onClose();
    } catch {
      setError("Network error during upload");
    } finally {
      setIsUploading(false);
      setFileName(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/40"
        disabled={isUploading}
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isUploading}
        className="relative z-[61] w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {isUploading ? "Uploading source" : "Add Source"}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {isUploading
            ? fileName
              ? `Working on “${fileName}”…`
              : "Please wait while we upload your file."
            : "Upload a PDF or plain text file to this notebook."}
        </p>

        {isUploading ? (
          <div className="mt-5" aria-live="polite">
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-3">
              <span
                className="size-5 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
                aria-hidden="true"
              />
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">
                  {UPLOAD_STEPS[Math.min(stepIndex, UPLOAD_STEPS.length - 1)]}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {elapsedSec < 1
                    ? "Starting…"
                    : `${elapsedSec}s elapsed · usually under 10s`}
                </p>
              </div>
            </div>

            <ol className="space-y-2">
              {UPLOAD_STEPS.map((step, index) => {
                const done = index < stepIndex;
                const active = index === stepIndex;
                return (
                  <li
                    key={step}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                      active
                        ? "border-[var(--accent)]/40 bg-[var(--accent)]/5 text-[var(--foreground)]"
                        : done
                          ? "border-[var(--border)] text-[var(--foreground)]"
                          : "border-[var(--border)] text-[var(--muted)]"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                        done || active
                          ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                          : "bg-[var(--sidebar)] text-[var(--muted)]"
                      )}
                      aria-hidden="true"
                    >
                      {done ? "✓" : index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                void uploadFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <input
              ref={textInputRef}
              type="file"
              accept="text/plain,.txt"
              className="hidden"
              onChange={(event) => {
                void uploadFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            <button
              type="button"
              onClick={() => pdfInputRef.current?.click()}
              className="rounded-xl border border-[var(--border)] px-3 py-3 text-left text-sm font-medium transition hover:bg-[var(--sidebar)]"
            >
              Upload PDF
            </button>
            <button
              type="button"
              onClick={() => textInputRef.current?.click()}
              className="rounded-xl border border-[var(--border)] px-3 py-3 text-left text-sm font-medium transition hover:bg-[var(--sidebar)]"
            >
              Upload Text File
            </button>

            <p className="text-[11px] text-[var(--muted)]">
              Allowed: {SOURCE_ALLOWED_MEDIA_TYPES.join(", ")}
            </p>
          </div>
        )}

        {error ? (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--sidebar)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? "Uploading…" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

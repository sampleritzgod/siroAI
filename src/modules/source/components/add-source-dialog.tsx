"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import {
  MAX_UPLOAD_BYTES,
  SOURCE_ALLOWED_MEDIA_TYPES,
  resolveSourceMediaType,
} from "@/modules/source/constants";

const UPLOAD_STEPS = [
  "Uploading…",
  "Storing file…",
  "Extracting text…",
  "Saving…",
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
  const [stepIndex, setStepIndex] = useState(-1);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPending, onClose]);

  useEffect(() => {
    if (!isPending) {
      setStepIndex(-1);
      return;
    }

    setStepIndex(0);
    const timers = [
      window.setTimeout(() => setStepIndex(1), 350),
      window.setTimeout(() => setStepIndex(2), 800),
      window.setTimeout(() => setStepIndex(3), 1300),
    ];
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, [isPending]);

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

  function uploadFile(file: File | undefined) {
    if (!file) return;

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

    startTransition(() => {
      void (async () => {
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
                      ? "PDF parsing failed"
                      : "Unexpected server error")
            );
            return;
          }

          onUploaded();
          onClose();
        } catch {
          setError("Network error during upload");
        }
      })();
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/40"
        disabled={isPending}
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-[61] w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          Add Source
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Upload a PDF or plain text file to this notebook.
        </p>

        {isPending ? (
          <ol className="mt-5 space-y-2" aria-live="polite">
            {UPLOAD_STEPS.map((step, index) => (
              <li
                key={step}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm",
                  index <= stepIndex
                    ? "border-[var(--accent)]/40 bg-[var(--accent)]/5 text-[var(--foreground)]"
                    : "border-[var(--border)] text-[var(--muted)]"
                )}
              >
                {step}
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                uploadFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <input
              ref={textInputRef}
              type="file"
              accept="text/plain,.txt"
              className="hidden"
              onChange={(event) => {
                uploadFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            <button
              type="button"
              onClick={() => pdfInputRef.current?.click()}
              className="rounded-xl border border-[var(--border)] px-3 py-3 text-left text-sm font-medium transition hover:bg-[var(--sidebar)]"
            >
              📄 Upload PDF
            </button>
            <button
              type="button"
              onClick={() => textInputRef.current?.click()}
              className="rounded-xl border border-[var(--border)] px-3 py-3 text-left text-sm font-medium transition hover:bg-[var(--sidebar)]"
            >
              📝 Upload Text File
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
            disabled={isPending}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--sidebar)] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

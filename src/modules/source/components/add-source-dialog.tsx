"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { SOURCE_ALLOWED_MEDIA_TYPES } from "@/modules/source/constants";

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

  function uploadFile(file: File | undefined) {
    if (!file) return;
    setError(null);

    startTransition(() => {
      void (async () => {
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
          setError(payload?.error || "Upload failed");
          return;
        }

        onUploaded();
        onClose();
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
          Upload a PDF or plain text file to this notebook. Text will be
          extracted now; indexing comes later.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            disabled={isPending}
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
            disabled={isPending}
            onChange={(event) => {
              uploadFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />

          <button
            type="button"
            disabled={isPending}
            onClick={() => pdfInputRef.current?.click()}
            className={cn(
              "rounded-xl border border-[var(--border)] px-3 py-3 text-left text-sm font-medium transition hover:bg-[var(--sidebar)] disabled:opacity-50"
            )}
          >
            📄 Upload PDF
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => textInputRef.current?.click()}
            className="rounded-xl border border-[var(--border)] px-3 py-3 text-left text-sm font-medium transition hover:bg-[var(--sidebar)] disabled:opacity-50"
          >
            📝 Upload Text File
          </button>

          <p className="text-[11px] text-[var(--muted)]">
            Allowed: {SOURCE_ALLOWED_MEDIA_TYPES.join(", ")}
          </p>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {isPending ? (
          <p className="mt-3 text-sm text-[var(--muted)]" aria-live="polite">
            Uploading and extracting…
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

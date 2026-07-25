"use client";

import { useEffect, useId, useState, useTransition } from "react";
import { deleteNotebook } from "@/modules/notebook/actions/notebook-actions";

type DeleteNotebookDialogProps = {
  open: boolean;
  notebookId: string | null;
  notebookTitle: string;
  isOnlyNotebook: boolean;
  onClose: () => void;
  onDeleted: (notebookId: string) => void;
};

export function DeleteNotebookDialog({
  open,
  notebookId,
  notebookTitle,
  isOnlyNotebook,
  onClose,
  onDeleted,
}: DeleteNotebookDialogProps) {
  if (!open || !notebookId) return null;

  return (
    <DeleteNotebookDialogForm
      key={notebookId}
      notebookId={notebookId}
      notebookTitle={notebookTitle}
      isOnlyNotebook={isOnlyNotebook}
      onClose={onClose}
      onDeleted={onDeleted}
    />
  );
}

function DeleteNotebookDialogForm({
  notebookId,
  notebookTitle,
  isOnlyNotebook,
  onClose,
  onDeleted,
}: {
  notebookId: string;
  notebookTitle: string;
  isOnlyNotebook: boolean;
  onClose: () => void;
  onDeleted: (notebookId: string) => void;
}) {
  const titleId = useId();
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const confirmed =
    confirmText.trim().toLowerCase() === notebookTitle.trim().toLowerCase();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPending, onClose]);

  function confirmDelete() {
    if (isOnlyNotebook || !confirmed) return;
    setError(null);

    startTransition(() => {
      void deleteNotebook(notebookId)
        .then(() => {
          onDeleted(notebookId);
          onClose();
        })
        .catch((err: unknown) => {
          setError(
            err instanceof Error ? err.message : "Could not delete notebook"
          );
        });
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
          Hide notebook?
        </h2>

        {isOnlyNotebook ? (
          <p className="mt-2 text-sm text-[var(--muted)]" role="alert">
            You need at least one notebook. Create another notebook before
            deleting &ldquo;{notebookTitle}&rdquo;.
          </p>
        ) : (
          <div className="mt-2 space-y-3 text-sm text-[var(--muted)]">
            <p>
              This hides &ldquo;{notebookTitle}&rdquo; from the sidebar. Sources
              and chat history are kept and can be restored later.
            </p>
            <label className="flex flex-col gap-1.5 text-[var(--foreground)]">
              <span>
                Type <strong>{notebookTitle}</strong> to confirm
              </span>
              <input
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                disabled={isPending}
                autoFocus
                className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 outline-none focus:border-[var(--accent)]"
                placeholder={notebookTitle}
              />
            </label>
          </div>
        )}

        {error ? (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--sidebar)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            disabled={isPending || isOnlyNotebook || !confirmed}
            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Hiding…" : "Hide notebook"}
          </button>
        </div>
      </div>
    </div>
  );
}

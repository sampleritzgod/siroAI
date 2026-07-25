"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import { createNotebook } from "@/modules/notebook/actions/notebook-actions";
import { NOTEBOOK_TITLE_MAX_LENGTH } from "@/modules/notebook/validation";

type CreateNotebookDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (notebookId: string) => void;
};

export function CreateNotebookDialog({
  open,
  onClose,
  onCreated,
}: CreateNotebookDialogProps) {
  if (!open) return null;

  return (
    <CreateNotebookDialogForm
      key="create-notebook-dialog"
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

function CreateNotebookDialogForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (notebookId: string) => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setTimeout(() => titleRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPending, onClose]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    startTransition(() => {
      void createNotebook({ title, description })
        .then((notebook) => {
          onCreated(notebook.id);
          onClose();
        })
        .catch((err: unknown) => {
          setError(
            err instanceof Error ? err.message : "Could not create notebook"
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
          Create Notebook
        </h2>
        <p id={descriptionId} className="mt-1 text-sm text-[var(--muted)]">
          Organize chats and knowledge in a dedicated notebook.
        </p>

        <form className="mt-4 flex flex-col gap-3" onSubmit={submit}>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">
              Title <span className="text-red-600">*</span>
            </span>
            <input
              ref={titleRef}
              value={title}
              maxLength={NOTEBOOK_TITLE_MAX_LENGTH}
              onChange={(event) => setTitle(event.target.value)}
              disabled={isPending}
              required
              aria-describedby={descriptionId}
              className="rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 outline-none focus:border-[var(--accent)]"
              placeholder="e.g. Research Papers"
            />
            <span className="text-[11px] text-[var(--muted)]">
              {title.trim().length}/{NOTEBOOK_TITLE_MAX_LENGTH}
            </span>
          </label>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={isPending}
              rows={3}
              className="resize-none rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 outline-none focus:border-[var(--accent)]"
              placeholder="Optional"
            />
          </label>

          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--sidebar)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isPending || !title.trim()}
              className={cn(
                "rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              )}
            >
              {isPending ? "Creating…" : "Create Notebook"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

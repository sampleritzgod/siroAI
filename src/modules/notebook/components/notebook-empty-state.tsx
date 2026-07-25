"use client";

type NotebookEmptyStateProps = {
  onCreate: () => void;
};

export function NotebookEmptyState({ onCreate }: NotebookEmptyStateProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 px-4 text-center sm:px-6">
      <div className="flex flex-col gap-3">
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
          Notebook Library
        </p>
        <h1 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl">
          Welcome to your Notebook Library.
        </h1>
        <p className="max-w-md text-sm text-[var(--muted)] sm:text-base">
          Create your first notebook to start organizing your knowledge.
        </p>
      </div>

      <button
        type="button"
        onClick={onCreate}
        className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
      >
        Create Notebook
      </button>
    </div>
  );
}

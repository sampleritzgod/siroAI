"use client";

type NotebookEmptyStateProps = {
  onCreate: () => void;
  error?: string | null;
};

export function NotebookEmptyState({ onCreate, error }: NotebookEmptyStateProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-6 text-center">
      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          Create your first notebook
        </h1>
        <p className="text-sm leading-relaxed text-[var(--muted)]">
          We&apos;ll name it automatically. You can rename it anytime from the
          sidebar.
        </p>
      </div>

      <button
        type="button"
        onClick={onCreate}
        className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
      >
        New Notebook
      </button>

      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

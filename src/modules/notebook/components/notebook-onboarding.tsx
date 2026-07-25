"use client";

type NotebookOnboardingProps = {
  onAddSource: () => void;
};

export function NotebookOnboarding({ onAddSource }: NotebookOnboardingProps) {
  return (
    <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto bg-[var(--background)] px-6 py-10">
      <div className="w-full max-w-md text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          This notebook is empty.
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          Add a PDF, text file, website, or YouTube video. Chat opens
          automatically once it finishes indexing — you do not need to click New
          Chat.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
          {["PDF", "Text", "VTT", "Website", "YouTube"].map((type) => (
            <span
              key={type}
              className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--muted)]"
            >
              {type}
            </span>
          ))}
        </div>

        <button
          type="button"
          onClick={onAddSource}
          className="mt-8 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
        >
          Add Source
        </button>
      </div>
    </div>
  );
}

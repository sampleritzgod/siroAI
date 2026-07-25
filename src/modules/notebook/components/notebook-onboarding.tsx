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
          Add a PDF, text file, or website. Chat opens automatically once it
          finishes indexing — you do not need to click New Chat.
        </p>

        <div className="mt-8 grid gap-4 text-left sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              Supported today
            </p>
            <ul className="mt-2 space-y-1.5 text-sm">
              <li>✓ PDF</li>
              <li>✓ Text</li>
              <li>✓ Website</li>
            </ul>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
              Coming Soon
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-[var(--muted)]">
              <li>YouTube</li>
              <li>Audio</li>
              <li>VTT</li>
            </ul>
          </div>
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

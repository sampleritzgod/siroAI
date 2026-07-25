const STUDIO_TOOLS = [
  "Flashcards",
  "Study Guide",
  "Timeline",
  "Mind Map",
  "Podcast",
  "Quiz",
] as const;

export function StudioPanel() {
  return (
    <aside className="flex h-full min-h-0 flex-col bg-[var(--sidebar)]">
      <div className="flex h-14 shrink-0 items-center border-b border-[var(--border)] px-4">
        <h2 className="text-sm font-semibold tracking-tight">Studio</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        <div className="grid grid-cols-1 gap-2">
          {STUDIO_TOOLS.map((tool) => (
            <div
              key={tool}
              aria-disabled="true"
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-4 opacity-60"
            >
              <p className="text-sm font-medium">{tool}</p>
              <p className="mt-1 text-xs text-[var(--muted)]">Coming Soon</p>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

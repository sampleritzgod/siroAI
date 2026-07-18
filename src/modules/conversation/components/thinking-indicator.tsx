export function ThinkingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-1 py-2 text-sm text-[var(--muted)]">
      <span className="sr-only">Thinking</span>
      <span className="size-1.5 animate-pulse rounded-full bg-[var(--muted)] [animation-delay:0ms]" />
      <span className="size-1.5 animate-pulse rounded-full bg-[var(--muted)] [animation-delay:150ms]" />
      <span className="size-1.5 animate-pulse rounded-full bg-[var(--muted)] [animation-delay:300ms]" />
    </div>
  );
}

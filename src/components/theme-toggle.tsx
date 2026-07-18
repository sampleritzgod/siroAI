"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  if (!mounted) {
    return (
      <button
        type="button"
        aria-label="Toggle theme"
        className="rounded-lg px-2 py-1.5 text-xs text-[var(--muted)]"
        disabled
      >
        ☾
      </button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light" : "Dark"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-[var(--muted)] transition hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
    >
      <span aria-hidden>{isDark ? "☀" : "☾"}</span>
      <span>{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}

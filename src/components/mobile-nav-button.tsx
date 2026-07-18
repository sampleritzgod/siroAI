"use client";

import { useSidebar } from "@/components/sidebar-context";

export function MobileNavButton() {
  const { toggle } = useSidebar();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Open sidebar"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] md:hidden"
    >
      <span aria-hidden className="text-lg leading-none">
        ☰
      </span>
    </button>
  );
}

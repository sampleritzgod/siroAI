/**
 * Auto-generates the next notebook title from existing titles.
 * Untitled notebook → Untitled notebook 2 → Untitled notebook 3 …
 */
export function suggestNextNotebookTitle(existingTitles: string[]): string {
  const used = new Set(
    existingTitles.map((title) => title.trim().toLowerCase()).filter(Boolean)
  );

  const base = "Untitled notebook";
  if (!used.has(base.toLowerCase())) {
    return base;
  }

  let n = 2;
  while (used.has(`${base} ${n}`.toLowerCase())) {
    n += 1;
  }
  return `${base} ${n}`;
}

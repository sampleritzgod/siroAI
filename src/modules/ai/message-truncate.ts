/**
 * Pure helpers for regenerate / truncate — unit-tested without DB.
 */

export type TimelineRowRef = {
  id: string;
  branchId: string;
};

/**
 * Message ids owned by `branchId` that appear after `afterMessageId` on the timeline.
 * Ancestor-owned rows are never included (safe to delete only these).
 */
export function branchOwnedIdsAfter(
  timeline: TimelineRowRef[],
  afterMessageId: string,
  branchId: string
): string[] {
  const index = timeline.findIndex((row) => row.id === afterMessageId);
  if (index < 0) {
    return [];
  }

  return timeline
    .slice(index + 1)
    .filter((row) => row.branchId === branchId)
    .map((row) => row.id);
}

/**
 * Keep timeline through `throughMessageId` (inclusive). Empty if id missing.
 */
export function truncateTimelineThrough<T extends { id: string }>(
  timeline: T[],
  throughMessageId: string
): T[] {
  const index = timeline.findIndex((row) => row.id === throughMessageId);
  if (index < 0) {
    return [];
  }
  return timeline.slice(0, index + 1);
}

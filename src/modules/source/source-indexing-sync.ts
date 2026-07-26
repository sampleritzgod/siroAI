import type { SourceListItem } from "@/modules/source/service";

const STATUS_RANK: Record<SourceListItem["indexingStatus"], number> = {
  PENDING: 0,
  PROCESSING: 1,
  INDEXED: 2,
  FAILED: 2,
};

/** True when any source still needs indexing work. */
export function hasSourcesIndexing(sources: SourceListItem[]): boolean {
  return sources.some(
    (source) =>
      source.indexingStatus === "PROCESSING" ||
      source.indexingStatus === "PENDING"
  );
}

function updatedAtMs(source: SourceListItem): number {
  const value = source.updatedAt;
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Prefer the more advanced indexing status so a stale RSC payload cannot
 * overwrite a live poll that already saw INDEXED/FAILED.
 */
export function preferSourceStatus(
  current: SourceListItem,
  incoming: SourceListItem
): SourceListItem {
  if (current.id !== incoming.id) return incoming;

  const currentRank = STATUS_RANK[current.indexingStatus];
  const incomingRank = STATUS_RANK[incoming.indexingStatus];

  if (incomingRank > currentRank) return incoming;
  if (incomingRank < currentRank) return current;

  // Same rank: prefer newer metadata (title rename, etc.).
  return updatedAtMs(incoming) >= updatedAtMs(current) ? incoming : current;
}

/**
 * Merge server/poll rows into local list. Patches matching ids in place;
 * appends new ids; keeps optimistic local-only in-flight rows until the
 * server/poll lists them.
 */
export function mergeSourceLists(
  local: SourceListItem[],
  incoming: SourceListItem[]
): SourceListItem[] {
  if (incoming.length === 0) {
    return local;
  }

  const localById = new Map(local.map((source) => [source.id, source]));
  const merged = incoming.map((item) => {
    const existing = localById.get(item.id);
    return existing ? preferSourceStatus(existing, item) : item;
  });

  const incomingIds = new Set(incoming.map((source) => source.id));
  const optimistic = local.filter(
    (source) =>
      !incomingIds.has(source.id) &&
      (source.indexingStatus === "PROCESSING" ||
        source.indexingStatus === "PENDING")
  );

  return [...optimistic, ...merged];
}

export function upsertSource(
  local: SourceListItem[],
  source: SourceListItem
): SourceListItem[] {
  return mergeSourceLists(local, [source]);
}

export const SOURCE_INDEXING_POLL_MS = 2000;
export const SOURCE_INDEXING_BACKOFF_MAX_MS = 30_000;

export function indexingPollBackoffMs(failureCount: number): number {
  if (failureCount <= 0) return SOURCE_INDEXING_POLL_MS;
  return Math.min(
    SOURCE_INDEXING_BACKOFF_MAX_MS,
    SOURCE_INDEXING_POLL_MS * 2 ** (failureCount - 1)
  );
}

import type { SourceListItem } from "@/modules/source/service";

/**
 * A source is usable for chat only after embeddings are persisted (INDEXED).
 */
export function isSourceReady(source: SourceListItem): boolean {
  return source.indexingStatus === "INDEXED";
}

export function isNotebookReady(sources: SourceListItem[]): boolean {
  return sources.some(isSourceReady);
}

export function isNotebookIndexing(sources: SourceListItem[]): boolean {
  if (sources.length === 0 || isNotebookReady(sources)) return false;
  return sources.some(
    (source) =>
      source.indexingStatus === "PROCESSING" ||
      source.indexingStatus === "PENDING"
  );
}

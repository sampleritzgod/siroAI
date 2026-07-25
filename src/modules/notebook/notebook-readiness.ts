import type { SourceListItem } from "@/modules/source/service";

/**
 * A source is usable for chat once indexing finished successfully.
 * PENDING + extracted text covers legacy rows created before INDEXED
 * was the terminal success status.
 */
export function isSourceReady(source: SourceListItem): boolean {
  if (source.indexingStatus === "INDEXED") return true;
  if (source.indexingStatus === "PENDING" && source.hasExtractedText) {
    return true;
  }
  return false;
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

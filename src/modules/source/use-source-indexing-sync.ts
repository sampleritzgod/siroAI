"use client";

import { useEffect, useRef, useState } from "react";
import { listNotebookSources } from "@/modules/source/actions/source-actions";
import type { SourceListItem } from "@/modules/source/service";
import {
  hasSourcesIndexing,
  indexingPollBackoffMs,
  mergeSourceLists,
  SOURCE_INDEXING_POLL_MS,
  upsertSource,
} from "@/modules/source/source-indexing-sync";

/**
 * Keeps notebook source rows in local React state and polls status while any
 * row is PROCESSING/PENDING. Never calls router.refresh / revalidatePath.
 */
export function useSourceIndexingSync(input: {
  notebookId: string;
  serverSources: SourceListItem[];
}) {
  const { notebookId, serverSources } = input;
  const [sources, setSources] = useState<SourceListItem[]>(serverSources);
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;

  // Notebook switch: reset to that notebook's server list.
  const [trackedNotebookId, setTrackedNotebookId] = useState(notebookId);
  if (trackedNotebookId !== notebookId) {
    setTrackedNotebookId(notebookId);
    setSources(serverSources);
  }

  // Merge RSC updates without regressing live INDEXED/FAILED from polling.
  const serverSignature = serverSources
    .map(
      (source) =>
        `${source.id}:${source.indexingStatus}:${source.title}:${source.updatedAt instanceof Date ? source.updatedAt.toISOString() : String(source.updatedAt)}`
    )
    .join("|");

  useEffect(() => {
    setSources((prev) => mergeSourceLists(prev, serverSources));
    // serverSignature captures meaningful server prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [notebookId, serverSignature]);

  const shouldPoll = hasSourcesIndexing(sources);

  useEffect(() => {
    if (!shouldPoll) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let failures = 0;

    async function tick() {
      if (cancelled || inFlight) return;
      inFlight = true;

      try {
        const fresh = await listNotebookSources(notebookId);
        if (cancelled) return;
        failures = 0;
        const next = mergeSourceLists(sourcesRef.current, fresh);
        sourcesRef.current = next;
        setSources(next);
      } catch {
        if (cancelled) return;
        failures += 1;
      } finally {
        inFlight = false;
        if (!cancelled) {
          const stillIndexing = hasSourcesIndexing(sourcesRef.current);
          if (stillIndexing) {
            const delay = indexingPollBackoffMs(failures);
            timer = setTimeout(() => {
              void tick();
            }, delay);
          }
        }
      }
    }

    // Immediate first poll, then every 2s (or backoff after errors).
    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [notebookId, shouldPoll]);

  function acceptUploadedSource(source: SourceListItem) {
    setSources((prev) => {
      const next = upsertSource(prev, source);
      sourcesRef.current = next;
      return next;
    });
  }

  function refreshFromServer() {
    void listNotebookSources(notebookId).then((fresh) => {
      setSources((prev) => {
        const next = mergeSourceLists(prev, fresh);
        sourcesRef.current = next;
        return next;
      });
    });
  }

  return {
    sources,
    acceptUploadedSource,
    refreshFromServer,
    isPolling: shouldPoll,
    pollIntervalMs: SOURCE_INDEXING_POLL_MS,
  };
}

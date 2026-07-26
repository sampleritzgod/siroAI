"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { MessageCitation } from "@/modules/rag/citation-types";
import {
  SourceViewerDialog,
  type SourceViewerTarget,
} from "@/modules/source/components/source-viewer-dialog";

type SourceViewerContextValue = {
  openTarget: (target: SourceViewerTarget) => void;
  openCitation: (citation: MessageCitation) => void;
};

const SourceViewerContext = createContext<SourceViewerContextValue | null>(null);

/**
 * Hosts the single Source Viewer modal for a conversation.
 * Returns null outside the provider (e.g. shared read-only pages), so callers
 * can fall back to plain, non-clickable citations.
 */
export function useSourceViewer(): SourceViewerContextValue | null {
  return useContext(SourceViewerContext);
}

export function SourceViewerProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [target, setTarget] = useState<SourceViewerTarget | null>(null);

  const openTarget = useCallback((next: SourceViewerTarget) => {
    setTarget(next);
  }, []);

  const openCitation = useCallback((citation: MessageCitation) => {
    setTarget({
      sourceId: citation.sourceId,
      attachmentId: citation.attachmentId,
      chunkIndex: citation.chunkIndex,
      page: citation.page,
      fallbackTitle: citation.filename,
      citation,
    });
  }, []);

  const value = useMemo(
    () => ({ openTarget, openCitation }),
    [openTarget, openCitation]
  );

  return (
    <SourceViewerContext.Provider value={value}>
      {children}
      <SourceViewerDialog target={target} onClose={() => setTarget(null)} />
    </SourceViewerContext.Provider>
  );
}

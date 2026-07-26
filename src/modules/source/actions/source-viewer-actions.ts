"use server";

import { requireUser } from "@/modules/auth/actions/require-user";
import {
  loadSourceViewerData,
  type SourceViewerData,
} from "@/modules/source/source-viewer";

export type { SourceViewerData } from "@/modules/source/source-viewer";

export type SourceViewerRequest = {
  sourceId?: string | null;
  attachmentId?: string | null;
  chunkIndex?: number | null;
};

/** Read-only source payload for the Source Viewer modal. */
export async function getSourceViewerData(
  input: SourceViewerRequest
): Promise<SourceViewerData | null> {
  const user = await requireUser();
  return loadSourceViewerData({ ...input, userId: user.id });
}

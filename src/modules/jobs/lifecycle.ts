import { prisma } from "@/lib/db";

export type IndexingLifecycleReason =
  | "source_deleted"
  | "source_deleted_during_indexing"
  | "already_completed"
  | "duplicate_ignored"
  | "cancelled";

/**
 * Terminal, non-retryable indexing outcome. Workers must CANCEL/SKIP the job
 * at INFO level — never fail, never retry, never report as ERROR.
 */
export class IndexingLifecycleSkip extends Error {
  readonly reason: IndexingLifecycleReason;
  readonly phase?: string;

  constructor(
    reason: IndexingLifecycleReason,
    message: string,
    phase?: string
  ) {
    super(message);
    this.name = "IndexingLifecycleSkip";
    this.reason = reason;
    this.phase = phase;
  }
}

export function isIndexingLifecycleSkip(
  error: unknown
): error is IndexingLifecycleSkip {
  return error instanceof IndexingLifecycleSkip;
}

export function lifecycleLogMessage(reason: IndexingLifecycleReason): string {
  switch (reason) {
    case "source_deleted":
      return "INDEX_SOURCE skipped (source deleted)";
    case "source_deleted_during_indexing":
      return "INDEX_SOURCE cancelled";
    case "already_completed":
      return "INDEX_SOURCE already completed";
    case "duplicate_ignored":
      return "INDEX_SOURCE duplicate ignored";
    case "cancelled":
      return "INDEX_SOURCE cancelled";
  }
}

/** Verify the source row still exists before a major indexing stage. */
export async function assertSourceAliveForIndexing(input: {
  sourceId: string;
  notebookId: string;
  phase: string;
}): Promise<void> {
  const source = await prisma.source.findFirst({
    where: {
      id: input.sourceId,
      notebookId: input.notebookId,
    },
    select: { id: true },
  });

  if (!source) {
    throw new IndexingLifecycleSkip(
      "source_deleted_during_indexing",
      lifecycleLogMessage("source_deleted_during_indexing"),
      input.phase
    );
  }
}

/** Best-effort orphan chunk cleanup when a source disappears mid-index. */
export async function cleanupPartialSourceIndex(
  sourceId: string
): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "DocumentChunk" WHERE "sourceId" = ${sourceId}
  `;
}

import { after } from "next/server";
import {
  enqueueJob,
  indexAttachmentIdempotencyKey,
  indexSourceIdempotencyKey,
} from "@/modules/jobs/queue";
import { processJobs } from "@/modules/jobs/worker";

/**
 * Persist an indexing job and drain aggressively via after().
 *
 * On Vercel Hobby, native Cron is limited to once/day — so after() is the
 * primary near-real-time drain. Cron (daily) + external schedulers remain
 * the backup for stranded jobs. See docs in .env.example / README.
 */
async function kickDrain(
  types: Array<"INDEX_SOURCE" | "INDEX_ATTACHMENT" | "PURGE_NOTEBOOK">
) {
  try {
    after(async () => {
      // First pass: process what we just enqueued (+ a few siblings).
      await processJobs({ limit: 5, types });
      // Second pass: catch anything that became ready during the first pass
      // (e.g. retries with nextRunAt ≈ now). Still within the same function.
      await processJobs({ limit: 5, types });
    });
  } catch {
    // Outside a Next.js request (unit tests / scripts): drain inline.
    await processJobs({ limit: 5, types });
  }
}

export async function enqueueSourceIndexing(input: {
  sourceId: string;
  notebookId: string;
}) {
  await enqueueJob({
    type: "INDEX_SOURCE",
    idempotencyKey: indexSourceIdempotencyKey(input.sourceId),
    payload: {
      sourceId: input.sourceId,
      notebookId: input.notebookId,
    },
  });

  await kickDrain(["INDEX_SOURCE"]);
}

export async function enqueueAttachmentIndexing(input: {
  attachmentId: string;
  conversationId: string;
}) {
  await enqueueJob({
    type: "INDEX_ATTACHMENT",
    idempotencyKey: indexAttachmentIdempotencyKey(input.attachmentId),
    payload: {
      attachmentId: input.attachmentId,
      conversationId: input.conversationId,
    },
  });

  await kickDrain(["INDEX_ATTACHMENT"]);
}

/**
 * Opportunistic drain when the UI polls for indexing status.
 * Safe to call frequently — claimNextJob is a no-op when the queue is empty.
 * No-ops outside a request scope (tests/scripts).
 */
export function scheduleOpportunisticJobDrain() {
  try {
    after(async () => {
      await processJobs({ limit: 3 });
    });
  } catch {
    // Ignored outside request scope.
  }
}

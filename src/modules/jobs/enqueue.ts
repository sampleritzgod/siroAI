import { after } from "next/server";
import {
  enqueueJob,
  indexAttachmentIdempotencyKey,
  indexSourceIdempotencyKey,
} from "@/modules/jobs/queue";
import { processJobs } from "@/modules/jobs/worker";

/**
 * Persist an indexing job and best-effort drain one item via after().
 * Durability comes from the DB row + cron; after() only reduces latency.
 */
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

  after(async () => {
    await processJobs({
      limit: 2,
      types: ["INDEX_SOURCE"],
    });
  });
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

  after(async () => {
    await processJobs({
      limit: 2,
      types: ["INDEX_ATTACHMENT"],
    });
  });
}

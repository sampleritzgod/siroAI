import "@/modules/notebook/load-test-env";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import {
  createNotebookForUser,
  deleteNotebookForUser,
} from "@/modules/notebook/service";
import {
  enqueueExpiredNotebookPurges,
  hardPurgeNotebook,
  NOTEBOOK_PURGE_RETENTION_DAYS,
} from "@/modules/notebook/purge";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());

describe("notebook hard purge", { skip: !hasDatabase }, () => {
  let userId = "";

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = await prisma.user.create({
      data: {
        clerkId: `purge_${suffix}`,
        email: `purge-${suffix}@example.com`,
      },
    });
    userId = user.id;
  });

  after(async () => {
    if (userId) {
      await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    }
  });

  it("hardPurgeNotebook is idempotent for missing notebooks", async () => {
    const result = await hardPurgeNotebook("does-not-exist");
    assert.equal(result.blobBytesFreed, 0);
    assert.equal(result.chunksDeleted, 0);
  });

  it("enqueues purge for notebooks past retention", async () => {
    const keep = await createNotebookForUser({
      userId,
      title: "Keep",
    });
    const doomed = await createNotebookForUser({
      userId,
      title: "Doomed",
    });

    await deleteNotebookForUser({ userId, notebookId: doomed.id });

    // Backdate soft-delete beyond retention.
    const past = new Date(
      Date.now() - (NOTEBOOK_PURGE_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000
    );
    await prisma.notebook.update({
      where: { id: doomed.id },
      data: { deletedAt: past },
    });

    const { enqueued } = await enqueueExpiredNotebookPurges();
    assert.ok(enqueued >= 1);

    const purged = await hardPurgeNotebook(doomed.id);
    assert.ok(purged.chunksDeleted >= 0);

    const gone = await prisma.notebook.findUnique({ where: { id: doomed.id } });
    assert.equal(gone, null);

    const still = await prisma.notebook.findUnique({ where: { id: keep.id } });
    assert.ok(still);
  });
});

import "@/modules/notebook/load-test-env";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import {
  createNotebookForUser,
  deleteNotebookForUser,
  getNotebookForUser,
  getUserNotebooksForUser,
  updateNotebookForUser,
} from "@/modules/notebook/service";
import { NOTEBOOK_TITLE_MAX_LENGTH } from "@/modules/notebook/validation";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());

describe("notebook service", { skip: !hasDatabase }, () => {
  let userAId = "";
  let userBId = "";

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const userA = await prisma.user.create({
      data: {
        clerkId: `test_notebook_a_${suffix}`,
        email: `notebook-a-${suffix}@example.com`,
      },
    });
    const userB = await prisma.user.create({
      data: {
        clerkId: `test_notebook_b_${suffix}`,
        email: `notebook-b-${suffix}@example.com`,
      },
    });

    userAId = userA.id;
    userBId = userB.id;
  });

  after(async () => {
    if (!userAId && !userBId) return;

    await prisma.user.deleteMany({
      where: { id: { in: [userAId, userBId].filter(Boolean) } },
    });
  });

  describe("createNotebookForUser", () => {
    it("creates a notebook with title and optional description", async () => {
      const notebook = await createNotebookForUser({
        userId: userAId,
        title: "  Biology 101  ",
        description: "  Lecture notes  ",
      });

      assert.equal(notebook.userId, userAId);
      assert.equal(notebook.title, "Biology 101");
      assert.equal(notebook.description, "Lecture notes");
      assert.ok(notebook.id);
      assert.ok(notebook.createdAt instanceof Date);
      assert.ok(notebook.updatedAt instanceof Date);

      await deleteNotebookForUser({
        userId: userAId,
        notebookId: notebook.id,
      });
    });

    it("rejects invalid titles", async () => {
      await assert.rejects(
        () =>
          createNotebookForUser({
            userId: userAId,
            title: "   ",
          }),
        /Title is required/
      );

      await assert.rejects(
        () =>
          createNotebookForUser({
            userId: userAId,
            title: "x".repeat(NOTEBOOK_TITLE_MAX_LENGTH + 1),
          }),
        /at most 100/
      );
    });
  });

  describe("updateNotebookForUser", () => {
    it("updates title and description", async () => {
      const created = await createNotebookForUser({
        userId: userAId,
        title: "Draft",
      });

      const updated = await updateNotebookForUser({
        userId: userAId,
        notebookId: created.id,
        title: "Final",
        description: "Ready",
      });

      assert.equal(updated.title, "Final");
      assert.equal(updated.description, "Ready");

      await deleteNotebookForUser({
        userId: userAId,
        notebookId: created.id,
      });
    });

    it("rejects invalid title updates", async () => {
      const created = await createNotebookForUser({
        userId: userAId,
        title: "Keep",
      });

      await assert.rejects(
        () =>
          updateNotebookForUser({
            userId: userAId,
            notebookId: created.id,
            title: "",
          }),
        /Title is required/
      );

      await deleteNotebookForUser({
        userId: userAId,
        notebookId: created.id,
      });
    });
  });

  describe("deleteNotebookForUser", () => {
    it("deletes an owned notebook", async () => {
      const created = await createNotebookForUser({
        userId: userAId,
        title: "Disposable",
      });

      await deleteNotebookForUser({
        userId: userAId,
        notebookId: created.id,
      });

      const found = await getNotebookForUser({
        userId: userAId,
        notebookId: created.id,
      });
      assert.equal(found, null);
    });
  });

  describe("authorization", () => {
    it("does not return another user's notebook", async () => {
      const created = await createNotebookForUser({
        userId: userAId,
        title: "Private A",
      });

      const asB = await getNotebookForUser({
        userId: userBId,
        notebookId: created.id,
      });
      assert.equal(asB, null);

      await deleteNotebookForUser({
        userId: userAId,
        notebookId: created.id,
      });
    });

    it("rejects update and delete by a non-owner", async () => {
      const created = await createNotebookForUser({
        userId: userAId,
        title: "Owned by A",
      });

      await assert.rejects(
        () =>
          updateNotebookForUser({
            userId: userBId,
            notebookId: created.id,
            title: "Hijacked",
          }),
        /Notebook not found/
      );

      await assert.rejects(
        () =>
          deleteNotebookForUser({
            userId: userBId,
            notebookId: created.id,
          }),
        /Notebook not found/
      );

      const stillThere = await getNotebookForUser({
        userId: userAId,
        notebookId: created.id,
      });
      assert.equal(stillThere?.title, "Owned by A");

      await deleteNotebookForUser({
        userId: userAId,
        notebookId: created.id,
      });
    });
  });

  describe("database CRUD and user isolation", () => {
    it("lists only the requesting user's notebooks", async () => {
      const a1 = await createNotebookForUser({
        userId: userAId,
        title: "A One",
      });
      const a2 = await createNotebookForUser({
        userId: userAId,
        title: "A Two",
      });
      const b1 = await createNotebookForUser({
        userId: userBId,
        title: "B One",
      });

      const listA = await getUserNotebooksForUser(userAId);
      const listB = await getUserNotebooksForUser(userBId);

      const idsA = new Set(listA.map((n) => n.id));
      const idsB = new Set(listB.map((n) => n.id));

      assert.equal(idsA.has(a1.id), true);
      assert.equal(idsA.has(a2.id), true);
      assert.equal(idsA.has(b1.id), false);

      assert.equal(idsB.has(b1.id), true);
      assert.equal(idsB.has(a1.id), false);
      assert.equal(idsB.has(a2.id), false);

      await deleteNotebookForUser({ userId: userAId, notebookId: a1.id });
      await deleteNotebookForUser({ userId: userAId, notebookId: a2.id });
      await deleteNotebookForUser({ userId: userBId, notebookId: b1.id });
    });

    it("persists create → read → update → delete round trip", async () => {
      const created = await createNotebookForUser({
        userId: userAId,
        title: "Round trip",
        description: "v1",
      });

      const read = await getNotebookForUser({
        userId: userAId,
        notebookId: created.id,
      });
      assert.equal(read?.title, "Round trip");
      assert.equal(read?.description, "v1");

      const updated = await updateNotebookForUser({
        userId: userAId,
        notebookId: created.id,
        title: "Round trip done",
        description: null,
      });
      assert.equal(updated.title, "Round trip done");
      assert.equal(updated.description, null);

      await deleteNotebookForUser({
        userId: userAId,
        notebookId: created.id,
      });

      const gone = await prisma.notebook.findUnique({
        where: { id: created.id },
      });
      assert.equal(gone, null);
    });
  });
});

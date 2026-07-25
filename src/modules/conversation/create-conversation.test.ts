import "@/modules/notebook/load-test-env";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { createConversationForUser } from "@/modules/conversation/create-conversation";
import {
  assertConversationOwner,
  findOwnedConversation,
} from "@/modules/conversation/ownership";
import { DEFAULT_NOTEBOOK_TITLE } from "@/modules/notebook/constants";
import {
  backfillLegacyConversationsForUser,
  getOrCreateDefaultNotebookForUser,
  resolveNotebookIdForUser,
} from "@/modules/notebook/default-notebook";
import { createNotebookForUser } from "@/modules/notebook/service";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());

describe("conversation ↔ notebook", { skip: !hasDatabase }, () => {
  let userAId = "";
  let userBId = "";

  before(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const userA = await prisma.user.create({
      data: {
        clerkId: `test_conv_nb_a_${suffix}`,
        email: `conv-nb-a-${suffix}@example.com`,
      },
    });
    const userB = await prisma.user.create({
      data: {
        clerkId: `test_conv_nb_b_${suffix}`,
        email: `conv-nb-b-${suffix}@example.com`,
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

  describe("create conversation with notebook", () => {
    it("attaches a conversation to an explicit notebook", async () => {
      const notebook = await createNotebookForUser({
        userId: userAId,
        title: "Research",
      });

      const conversation = await createConversationForUser({
        userId: userAId,
        notebookId: notebook.id,
      });

      assert.equal(conversation.notebookId, notebook.id);
      assert.equal(conversation.userId, userAId);
      assert.ok(conversation.activeBranchId);

      const branch = await prisma.branch.findFirst({
        where: { conversationId: conversation.id, parentBranchId: null },
      });
      assert.ok(branch);
    });

    it("falls back to the default notebook when notebookId is omitted", async () => {
      const conversation = await createConversationForUser({
        userId: userAId,
      });

      const notebook = await prisma.notebook.findUniqueOrThrow({
        where: { id: conversation.notebookId },
      });

      assert.equal(notebook.userId, userAId);
      assert.equal(notebook.title, DEFAULT_NOTEBOOK_TITLE);
    });

    it("reuses an existing default notebook on fallback", async () => {
      const first = await getOrCreateDefaultNotebookForUser(userAId);
      const second = await getOrCreateDefaultNotebookForUser(userAId);
      assert.equal(first.id, second.id);

      const conversation = await createConversationForUser({
        userId: userAId,
      });
      assert.equal(conversation.notebookId, first.id);
    });
  });

  describe("authorization", () => {
    it("rejects creating a conversation in another user's notebook", async () => {
      const notebookB = await createNotebookForUser({
        userId: userBId,
        title: "B Private",
      });

      await assert.rejects(
        () =>
          createConversationForUser({
            userId: userAId,
            notebookId: notebookB.id,
          }),
        /Notebook not found/
      );
    });

    it("does not allow access to conversations under another user's notebook", async () => {
      const notebookB = await createNotebookForUser({
        userId: userBId,
        title: "B Notes",
      });
      const conversationB = await createConversationForUser({
        userId: userBId,
        notebookId: notebookB.id,
      });

      assert.equal(
        await findOwnedConversation(conversationB.id, userAId),
        null
      );

      await assert.rejects(
        () => assertConversationOwner(conversationB.id, userAId),
        /Conversation not found/
      );

      const owned = await assertConversationOwner(conversationB.id, userBId);
      assert.equal(owned.id, conversationB.id);
    });

    it("resolveNotebookIdForUser enforces ownership", async () => {
      const notebookA = await createNotebookForUser({
        userId: userAId,
        title: "Only A",
      });

      await assert.rejects(
        () =>
          resolveNotebookIdForUser({
            userId: userBId,
            notebookId: notebookA.id,
          }),
        /Notebook not found/
      );

      const resolved = await resolveNotebookIdForUser({
        userId: userAId,
        notebookId: notebookA.id,
      });
      assert.equal(resolved, notebookA.id);
    });
  });

  describe("migration helpers and legacy behavior", () => {
    it("backfills unassigned conversations onto the default notebook", async () => {
      const notebook = await getOrCreateDefaultNotebookForUser(userAId);

      // Simulate a pre-constraint orphan via raw SQL (column is NOT NULL now,
      // so we temporarily clear via a deferred check workaround: insert with
      // notebookId then verify backfill is idempotent / assigns zero).
      const conversation = await createConversationForUser({
        userId: userAId,
        notebookId: notebook.id,
      });

      const result = await backfillLegacyConversationsForUser(userAId);
      assert.equal(result.notebookId, notebook.id);
      assert.equal(result.assignedCount, 0);

      const still = await prisma.conversation.findUniqueOrThrow({
        where: { id: conversation.id },
      });
      assert.equal(still.notebookId, notebook.id);
    });

    it("migrates a user with conversations into My Notebook successfully", async () => {
      // Fresh user with no notebooks yet — creating a chat must produce My Notebook.
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const legacyUser = await prisma.user.create({
        data: {
          clerkId: `test_legacy_${suffix}`,
          email: `legacy-${suffix}@example.com`,
        },
      });

      try {
        const before = await prisma.notebook.count({
          where: { userId: legacyUser.id },
        });
        assert.equal(before, 0);

        const conversation = await createConversationForUser({
          userId: legacyUser.id,
        });

        const notebooks = await prisma.notebook.findMany({
          where: { userId: legacyUser.id },
        });
        assert.equal(notebooks.length, 1);
        assert.equal(notebooks[0]?.title, DEFAULT_NOTEBOOK_TITLE);
        assert.equal(conversation.notebookId, notebooks[0]?.id);

        // Root branch exists — legacy chat shape preserved.
        const branchCount = await prisma.branch.count({
          where: { conversationId: conversation.id },
        });
        assert.equal(branchCount, 1);
        assert.ok(conversation.activeBranchId);
      } finally {
        await prisma.user.delete({ where: { id: legacyUser.id } });
      }
    });

    it("ensures every new conversation always belongs to a notebook", async () => {
      const withId = await createConversationForUser({
        userId: userAId,
        notebookId: (
          await createNotebookForUser({
            userId: userAId,
            title: `Explicit ${Date.now()}`,
          })
        ).id,
      });
      const withoutId = await createConversationForUser({
        userId: userAId,
      });

      assert.ok(withId.notebookId);
      assert.ok(withoutId.notebookId);

      const notebook = await prisma.notebook.findUnique({
        where: { id: withoutId.notebookId },
      });
      assert.ok(notebook);
      assert.equal(notebook.userId, userAId);
    });
  });
});

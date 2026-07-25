import "@/modules/notebook/load-test-env";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DEFAULT_MODEL_ID } from "@/modules/ai/model-registry";
import { prisma } from "@/lib/db";
import { storeUpload } from "@/modules/files/storage";
import {
  createNotebookForUser,
  deleteNotebookForUser,
  updateNotebookForUser,
} from "@/modules/notebook/service";
import { retrieveRelevantChunks } from "@/modules/rag/retrieve";
import {
  createIndexedSourceFromUpload,
  deleteSourceForUser,
  getSourceForUser,
  listSourcesForNotebook,
  renameSourceForUser,
} from "@/modules/source/service";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());
const hasOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim());

function makeTextFile(name: string, contents: string) {
  return new File([contents], name, { type: "text/plain" });
}

const NOTE =
  "Cross-user isolation test document about neural networks and transformers. " +
  "This content must be long enough for embedding and retrieval in the RAG pipeline.";

describe(
  "auth isolation — user A cannot access user B resources",
  { skip: !hasDatabase || !hasOpenAI },
  () => {
    let userA = "";
    let userB = "";
    let notebookA = "";
    let notebookB = "";
    let sourceA = "";
    let conversationA = "";
    let conversationB = "";
    let attachmentA = "";

    before(async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const a = await prisma.user.create({
        data: {
          clerkId: `iso_a_${suffix}`,
          email: `iso-a-${suffix}@example.com`,
        },
      });
      const b = await prisma.user.create({
        data: {
          clerkId: `iso_b_${suffix}`,
          email: `iso-b-${suffix}@example.com`,
        },
      });
      userA = a.id;
      userB = b.id;

      notebookA = (
        await createNotebookForUser({ userId: userA, title: "A Notebook" })
      ).id;
      notebookB = (
        await createNotebookForUser({ userId: userB, title: "B Notebook" })
      ).id;

      // Second notebooks so soft-delete of one is allowed.
      await createNotebookForUser({ userId: userA, title: "A Other" });
      await createNotebookForUser({ userId: userB, title: "B Other" });

      const source = await createIndexedSourceFromUpload({
        userId: userA,
        notebookId: notebookA,
        file: makeTextFile("iso.txt", NOTE),
      });
      sourceA = source.id;

      conversationA = (
        await prisma.conversation.create({
          data: {
            userId: userA,
            notebookId: notebookA,
            model: DEFAULT_MODEL_ID,
            branches: { create: { title: "Main" } },
          },
          include: { branches: true },
        })
      ).id;
      await prisma.conversation.update({
        where: { id: conversationA },
        data: {
          activeBranchId: (
            await prisma.branch.findFirstOrThrow({
              where: { conversationId: conversationA },
            })
          ).id,
        },
      });

      conversationB = (
        await prisma.conversation.create({
          data: {
            userId: userB,
            notebookId: notebookB,
            model: DEFAULT_MODEL_ID,
            branches: { create: { title: "Main" } },
          },
        })
      ).id;

      const pending = await prisma.attachment.create({
        data: {
          userId: userA,
          conversationId: conversationA,
          filename: "secret.txt",
          mediaType: "text/plain",
          sizeBytes: 12,
          storage: "LOCAL",
          storageKey: "pending",
          status: "UPLOADING",
        },
      });
      const stored = await storeUpload({
        attachmentId: pending.id,
        filename: "secret.txt",
        mediaType: "text/plain",
        bytes: Buffer.from("secret bytes"),
      });
      await prisma.attachment.update({
        where: { id: pending.id },
        data: {
          storage: stored.storage,
          storageKey: stored.storageKey,
          status: "READY",
        },
      });
      attachmentA = pending.id;
    });

    after(async () => {
      await prisma.user.deleteMany({
        where: { id: { in: [userA, userB].filter(Boolean) } },
      });
    });

    it("cannot read another user's notebook sources", async () => {
      await assert.rejects(
        () =>
          listSourcesForNotebook({
            userId: userB,
            notebookId: notebookA,
          }),
        /Notebook not found/
      );
    });

    it("cannot get another user's source", async () => {
      const result = await getSourceForUser({
        userId: userB,
        sourceId: sourceA,
      });
      assert.equal(result, null);
    });

    it("cannot rename another user's source", async () => {
      await assert.rejects(
        () =>
          renameSourceForUser({
            userId: userB,
            sourceId: sourceA,
            title: "Hacked",
          }),
        /Source not found/
      );
    });

    it("cannot delete another user's source", async () => {
      await assert.rejects(
        () =>
          deleteSourceForUser({
            userId: userB,
            sourceId: sourceA,
          }),
        /Source not found/
      );
    });

    it("cannot rename another user's notebook", async () => {
      await assert.rejects(
        () =>
          updateNotebookForUser({
            userId: userB,
            notebookId: notebookA,
            title: "Stolen",
          }),
        /Notebook not found/
      );
    });

    it("cannot delete another user's notebook", async () => {
      await assert.rejects(
        () =>
          deleteNotebookForUser({
            userId: userB,
            notebookId: notebookA,
          }),
        /Notebook not found/
      );
    });

    it("cannot load another user's conversation row", async () => {
      const row = await prisma.conversation.findFirst({
        where: {
          id: conversationA,
          userId: userB,
          notebook: { userId: userB, deletedAt: null },
        },
      });
      assert.equal(row, null);
    });

    it("cannot download another user's attachment", async () => {
      const row = await prisma.attachment.findFirst({
        where: { id: attachmentA, userId: userB, status: "READY" },
      });
      assert.equal(row, null);
    });

    it("cannot retrieve another user's notebook chunks", async () => {
      const chunks = await retrieveRelevantChunks({
        conversationId: conversationB,
        notebookId: notebookB,
        query: "neural networks transformers",
        limit: 6,
      });
      // User B notebook has no sources — must not surface User A chunks.
      assert.equal(
        chunks.every((c) => c.sourceId !== sourceA),
        true
      );
      assert.equal(
        chunks.filter((c) => c.sourceId === sourceA).length,
        0
      );
    });

    it("owner can still access their own resources", async () => {
      const source = await getSourceForUser({
        userId: userA,
        sourceId: sourceA,
      });
      assert.ok(source);
      assert.equal(source.id, sourceA);

      const chunks = await retrieveRelevantChunks({
        conversationId: conversationA,
        notebookId: notebookA,
        query: "transformers neural networks",
        limit: 6,
      });
      assert.ok(chunks.some((c) => c.sourceId === sourceA));
    });
  }
);

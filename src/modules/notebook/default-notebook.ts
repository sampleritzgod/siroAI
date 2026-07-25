import { prisma } from "@/lib/db";
import { DEFAULT_NOTEBOOK_TITLE } from "@/modules/notebook/constants";
import type { NotebookRecord } from "@/modules/notebook/service";

type NotebookDelegate = {
  findFirst: (args: {
    where: { userId: string; title: string; deletedAt?: null };
    orderBy: { createdAt: "asc" };
  }) => Promise<NotebookRecord | null>;
  create: (args: {
    data: { userId: string; title: string };
  }) => Promise<NotebookRecord>;
};

/**
 * Pure helper mirroring the SQL migration rule:
 * create a default notebook when the user has conversations and no "My Notebook" yet.
 */
export function needsDefaultNotebookForLegacyUser(input: {
  conversationCount: number;
  hasDefaultNotebook: boolean;
}): boolean {
  return input.conversationCount > 0 && !input.hasDefaultNotebook;
}

/**
 * Returns the user's default notebook ("My Notebook"), creating it only when missing.
 * Concurrent creates are tolerated: a race re-reads the existing row.
 */
export async function getOrCreateDefaultNotebookForUser(
  userId: string,
  client: NotebookDelegate = prisma.notebook
): Promise<NotebookRecord> {
  const existing = await client.findFirst({
    where: { userId, title: DEFAULT_NOTEBOOK_TITLE, deletedAt: null },
    orderBy: { createdAt: "asc" },
  });

  if (existing) {
    return existing;
  }

  try {
    return await client.create({
      data: {
        userId,
        title: DEFAULT_NOTEBOOK_TITLE,
      },
    });
  } catch {
    const raced = await client.findFirst({
      where: { userId, title: DEFAULT_NOTEBOOK_TITLE, deletedAt: null },
      orderBy: { createdAt: "asc" },
    });
    if (raced) {
      return raced;
    }
    throw new Error("Failed to create default notebook");
  }
}

/**
 * Resolves the notebook to use for a new conversation.
 * When notebookId is omitted, uses (and may create) the user's default notebook.
 * When provided, the notebook must belong to the user.
 */
export async function resolveNotebookIdForUser(input: {
  userId: string;
  notebookId?: string | null;
}): Promise<string> {
  const requested = input.notebookId?.trim();

  if (!requested) {
    const notebook = await getOrCreateDefaultNotebookForUser(input.userId);
    return notebook.id;
  }

  const notebook = await prisma.notebook.findFirst({
    where: { id: requested, userId: input.userId, deletedAt: null },
    select: { id: true },
  });

  if (!notebook) {
    throw new Error("Notebook not found");
  }

  return notebook.id;
}

/**
 * Assigns conversations with a null notebookId to the given notebook.
 * Mirrors the SQL backfill step; useful for repair and migration tests.
 */
export async function assignUnassignedConversationsToNotebook(input: {
  userId: string;
  notebookId: string;
}): Promise<number> {
  const result = await prisma.$executeRaw`
    UPDATE "Conversation"
    SET "notebookId" = ${input.notebookId}
    WHERE "userId" = ${input.userId}
      AND "notebookId" IS NULL
  `;

  return Number(result);
}

/**
 * Full legacy backfill for one user: ensure default notebook, assign null notebookIds.
 */
export async function backfillLegacyConversationsForUser(userId: string): Promise<{
  notebookId: string;
  assignedCount: number;
}> {
  const notebook = await getOrCreateDefaultNotebookForUser(userId);
  const assignedCount = await assignUnassignedConversationsToNotebook({
    userId,
    notebookId: notebook.id,
  });

  return { notebookId: notebook.id, assignedCount };
}

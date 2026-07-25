"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/actions/require-user";
import {
  createNotebookForUser,
  deleteNotebookForUser,
  getNotebookForUser,
  getUserNotebooksForUser,
  updateNotebookForUser,
  type NotebookListItem,
  type NotebookRecord,
} from "@/modules/notebook/service";
import { suggestNextNotebookTitle } from "@/modules/notebook/suggest-title";

/**
 * Creates a notebook for the signed-in user.
 * When title is omitted/blank, assigns an auto-generated name.
 */
export async function createNotebook(input?: {
  title?: string;
  description?: string | null;
}): Promise<NotebookRecord> {
  const user = await requireUser();
  const existing = await getUserNotebooksForUser(user.id);
  const requested = input?.title?.trim() ?? "";
  const title =
    requested.length > 0
      ? requested
      : suggestNextNotebookTitle(existing.map((item) => item.title));

  const notebook = await createNotebookForUser({
    userId: user.id,
    title,
    description: input?.description,
  });

  revalidatePath("/");
  return notebook;
}

/**
 * One-click notebook create with an auto-generated title.
 */
export async function createNotebookQuick(): Promise<NotebookRecord> {
  return createNotebook();
}

/**
 * Returns a notebook owned by the signed-in user, or null.
 */
export async function getNotebook(
  notebookId: string
): Promise<NotebookRecord | null> {
  const user = await requireUser();
  return getNotebookForUser({ userId: user.id, notebookId });
}

/**
 * Lists notebooks owned by the signed-in user (newest updated first).
 */
export async function getUserNotebooks(): Promise<NotebookListItem[]> {
  const user = await requireUser();
  return getUserNotebooksForUser(user.id);
}

/**
 * Updates a notebook owned by the signed-in user.
 */
export async function updateNotebook(input: {
  id: string;
  title?: string;
  description?: string | null;
}): Promise<NotebookRecord> {
  const user = await requireUser();
  const notebook = await updateNotebookForUser({
    userId: user.id,
    notebookId: input.id,
    title: input.title,
    description: input.description,
  });

  revalidatePath("/");
  return notebook;
}

/**
 * Deletes a notebook owned by the signed-in user.
 * Refuses to delete the user's only notebook.
 */
export async function deleteNotebook(id: string): Promise<void> {
  const user = await requireUser();
  await deleteNotebookForUser({ userId: user.id, notebookId: id });
  revalidatePath("/");
}

/**
 * Counts embedded document chunks for conversations in a notebook.
 * Read-only dashboard metric — does not change indexing or RAG behavior.
 */
export async function getNotebookIndexedChunkCount(
  notebookId: string
): Promise<number> {
  const user = await requireUser();

  const notebook = await getNotebookForUser({
    userId: user.id,
    notebookId,
  });
  if (!notebook) {
    throw new Error("Notebook not found");
  }

  return prisma.documentChunk.count({
    where: {
      conversation: {
        notebookId,
        userId: user.id,
      },
    },
  });
}

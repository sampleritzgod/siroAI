"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/modules/auth/actions/require-user";
import {
  createNotebookForUser,
  deleteNotebookForUser,
  getNotebookForUser,
  getUserNotebooksForUser,
  listDeletedNotebooksForUser,
  restoreNotebookForUser,
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
 * Soft-deletes a notebook owned by the signed-in user.
 * Sources and chat history are preserved for restore.
 * Refuses to delete the user's only active notebook.
 */
export async function deleteNotebook(id: string): Promise<void> {
  const user = await requireUser();
  await deleteNotebookForUser({ userId: user.id, notebookId: id });
  revalidatePath("/");
}

export async function listDeletedNotebooks(): Promise<NotebookListItem[]> {
  const user = await requireUser();
  return listDeletedNotebooksForUser(user.id);
}

export async function restoreNotebook(id: string): Promise<NotebookRecord> {
  const user = await requireUser();
  const notebook = await restoreNotebookForUser({
    userId: user.id,
    notebookId: id,
  });
  revalidatePath("/");
  return notebook;
}

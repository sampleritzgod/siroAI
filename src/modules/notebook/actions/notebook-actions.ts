"use server";

import { revalidatePath } from "next/cache";
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

/**
 * Creates a notebook for the signed-in user.
 */
export async function createNotebook(input: {
  title: string;
  description?: string | null;
}): Promise<NotebookRecord> {
  const user = await requireUser();
  const notebook = await createNotebookForUser({
    userId: user.id,
    title: input.title,
    description: input.description,
  });

  revalidatePath("/");
  return notebook;
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

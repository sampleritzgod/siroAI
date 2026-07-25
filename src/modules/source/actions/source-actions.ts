"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/modules/auth/actions/require-user";
import {
  deleteSourceForUser,
  getSourceForUser,
  listSourcesForNotebook,
  listSourcesForUser,
  renameSourceForUser,
  type SourceListItem,
  type SourceRecord,
} from "@/modules/source/service";

export async function listNotebookSources(
  notebookId: string
): Promise<SourceListItem[]> {
  const user = await requireUser();
  return listSourcesForNotebook({ userId: user.id, notebookId });
}

export async function listAllSources(): Promise<SourceListItem[]> {
  const user = await requireUser();
  return listSourcesForUser(user.id);
}

export async function getSource(
  sourceId: string
): Promise<SourceRecord | null> {
  const user = await requireUser();
  return getSourceForUser({ userId: user.id, sourceId });
}

export async function renameSource(input: {
  id: string;
  title: string;
}): Promise<SourceRecord> {
  const user = await requireUser();
  const source = await renameSourceForUser({
    userId: user.id,
    sourceId: input.id,
    title: input.title,
  });
  revalidatePath("/");
  return source;
}

export async function deleteSource(id: string): Promise<void> {
  const user = await requireUser();
  await deleteSourceForUser({ userId: user.id, sourceId: id });
  revalidatePath("/");
}

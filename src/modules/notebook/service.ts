import { prisma } from "@/lib/db";
import {
  validateNotebookDescription,
  validateNotebookTitle,
} from "@/modules/notebook/validation";

export type NotebookRecord = {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NotebookListItem = {
  id: string;
  title: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
};

async function assertNotebookOwner(notebookId: string, userId: string) {
  const notebook = await prisma.notebook.findFirst({
    where: { id: notebookId, userId },
  });

  if (!notebook) {
    throw new Error("Notebook not found");
  }

  return notebook;
}

export async function createNotebookForUser(input: {
  userId: string;
  title: string;
  description?: string | null;
}): Promise<NotebookRecord> {
  const titleResult = validateNotebookTitle(input.title);
  if (!titleResult.ok) {
    throw new Error(titleResult.error);
  }

  const descriptionResult = validateNotebookDescription(input.description);
  if (!descriptionResult.ok) {
    throw new Error(descriptionResult.error);
  }

  return prisma.notebook.create({
    data: {
      userId: input.userId,
      title: titleResult.title,
      description: descriptionResult.description,
    },
  });
}

export async function getNotebookForUser(input: {
  userId: string;
  notebookId: string;
}): Promise<NotebookRecord | null> {
  return prisma.notebook.findFirst({
    where: { id: input.notebookId, userId: input.userId },
  });
}

export async function getUserNotebooksForUser(
  userId: string
): Promise<NotebookListItem[]> {
  return prisma.notebook.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}

export async function updateNotebookForUser(input: {
  userId: string;
  notebookId: string;
  title?: string;
  description?: string | null;
}): Promise<NotebookRecord> {
  await assertNotebookOwner(input.notebookId, input.userId);

  const data: { title?: string; description?: string | null } = {};

  if (input.title !== undefined) {
    const titleResult = validateNotebookTitle(input.title);
    if (!titleResult.ok) {
      throw new Error(titleResult.error);
    }
    data.title = titleResult.title;
  }

  if (input.description !== undefined) {
    const descriptionResult = validateNotebookDescription(input.description);
    if (!descriptionResult.ok) {
      throw new Error(descriptionResult.error);
    }
    data.description = descriptionResult.description;
  }

  if (Object.keys(data).length === 0) {
    throw new Error("No notebook fields to update");
  }

  return prisma.notebook.update({
    where: { id: input.notebookId },
    data,
  });
}

export async function deleteNotebookForUser(input: {
  userId: string;
  notebookId: string;
}): Promise<void> {
  await assertNotebookOwner(input.notebookId, input.userId);

  await prisma.notebook.delete({
    where: { id: input.notebookId },
  });
}

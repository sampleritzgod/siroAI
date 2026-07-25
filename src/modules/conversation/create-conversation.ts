import { prisma } from "@/lib/db";
import { DEFAULT_MODEL_ID } from "@/modules/ai/model-registry";
import { resolveNotebookIdForUser } from "@/modules/notebook/default-notebook";

export type CreateConversationInput = {
  userId: string;
  /** When omitted, the user's default notebook ("My Notebook") is used. */
  notebookId?: string | null;
  model?: string | null;
};

/**
 * Creates a conversation with a root branch under a notebook the user owns.
 */
export async function createConversationForUser(input: CreateConversationInput) {
  const notebookId = await resolveNotebookIdForUser({
    userId: input.userId,
    notebookId: input.notebookId,
  });

  return prisma.$transaction(async (tx) => {
    const created = await tx.conversation.create({
      data: {
        userId: input.userId,
        notebookId,
        model: input.model ?? DEFAULT_MODEL_ID,
      },
    });

    const rootBranch = await tx.branch.create({
      data: {
        conversationId: created.id,
        title: "Main",
      },
    });

    return tx.conversation.update({
      where: { id: created.id },
      data: { activeBranchId: rootBranch.id },
    });
  });
}

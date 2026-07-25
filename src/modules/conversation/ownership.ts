import { prisma } from "@/lib/db";

/**
 * Loads a conversation only when the user owns it and owns its notebook.
 */
export async function findOwnedConversation(
  conversationId: string,
  userId: string
) {
  return prisma.conversation.findFirst({
    where: {
      id: conversationId,
      userId,
      notebook: { userId, deletedAt: null },
    },
  });
}

/**
 * Asserts the user owns the conversation (and its notebook).
 */
export async function assertConversationOwner(
  conversationId: string,
  userId: string
) {
  const conversation = await findOwnedConversation(conversationId, userId);

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  return conversation;
}

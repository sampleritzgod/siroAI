"use server";

import { revalidatePath } from "next/cache";
import { invalidateConversationCaches } from "@/lib/cache/invalidate";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/actions/require-user";
import { resolveBranchMessageRows } from "@/modules/conversation/utils/branch-timeline";

export type BranchListItem = {
  id: string;
  conversationId: string;
  parentBranchId: string | null;
  forkFromMessageId: string | null;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  isMain: boolean;
};

async function assertOwnsConversation(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  return conversation;
}

async function assertOwnsBranch(branchId: string, userId: string) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, conversation: { userId } },
  });

  if (!branch) {
    throw new Error("Branch not found");
  }

  return branch;
}

export async function listBranches(
  conversationId: string
): Promise<BranchListItem[]> {
  const user = await requireUser();
  await assertOwnsConversation(conversationId, user.id);

  const branches = await prisma.branch.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });

  return branches.map((branch) => ({
    id: branch.id,
    conversationId: branch.conversationId,
    parentBranchId: branch.parentBranchId,
    forkFromMessageId: branch.forkFromMessageId,
    title: branch.title,
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
    isMain: branch.parentBranchId == null,
  }));
}

/**
 * Fork for ChatGPT-style edit→branch: share history *before* the edited message,
 * then the client sends the edited user turn on the new branch.
 * Editing the first message creates an empty-start child (null fork).
 */
export async function createBranchForEdit(input: {
  conversationId: string;
  sourceBranchId: string;
  messageId: string;
  title?: string;
}) {
  const user = await requireUser();
  await assertOwnsConversation(input.conversationId, user.id);

  const sourceBranch = await assertOwnsBranch(input.sourceBranchId, user.id);
  if (sourceBranch.conversationId !== input.conversationId) {
    throw new Error("Branch does not belong to this conversation");
  }

  const timeline = await resolveBranchMessageRows(input.sourceBranchId);
  const editIndex = timeline.findIndex(
    (message) => message.id === input.messageId
  );

  if (editIndex < 0) {
    throw new Error("Message not found on this branch");
  }

  const editMessage = timeline[editIndex];
  if (editMessage.role !== "USER") {
    throw new Error("Only user messages can be edited");
  }

  const previous = editIndex > 0 ? timeline[editIndex - 1] : null;
  const defaultTitle = `Edit “${editMessage.content.slice(0, 32) || "message"}”`;
  // Parent must own the fork message (same rule as createBranchFromMessage).
  // First-message edit: new root sibling so the timeline starts empty.
  const parentBranchId = previous ? previous.branchId : null;
  const forkFromMessageId = previous?.id ?? null;

  const branch = await prisma.$transaction(async (tx) => {
    const created = await tx.branch.create({
      data: {
        conversationId: input.conversationId,
        parentBranchId,
        forkFromMessageId,
        title: input.title?.trim() || defaultTitle,
      },
    });

    await tx.conversation.update({
      where: { id: input.conversationId },
      data: { activeBranchId: created.id },
    });

    return created;
  });

  await invalidateConversationCaches({
    userId: user.id,
    conversationId: input.conversationId,
  });

  revalidatePath(`/c/${input.conversationId}`);
  return branch;
}

/**
 * Fork a new branch from a message visible on the current branch timeline.
 */
export async function createBranchFromMessage(input: {
  conversationId: string;
  sourceBranchId: string;
  messageId: string;
  title?: string;
}) {
  const user = await requireUser();
  await assertOwnsConversation(input.conversationId, user.id);

  const sourceBranch = await assertOwnsBranch(input.sourceBranchId, user.id);
  if (sourceBranch.conversationId !== input.conversationId) {
    throw new Error("Branch does not belong to this conversation");
  }

  const timeline = await resolveBranchMessageRows(input.sourceBranchId);
  const forkMessage = timeline.find((message) => message.id === input.messageId);

  if (!forkMessage) {
    throw new Error("Message not found on this branch");
  }

  // Parent must own the fork message so timeline truncation is correct.
  const parentBranchId = forkMessage.branchId;
  const defaultTitle = `Branch from “${forkMessage.content.slice(0, 32) || "message"}”`;

  const branch = await prisma.$transaction(async (tx) => {
    const created = await tx.branch.create({
      data: {
        conversationId: input.conversationId,
        parentBranchId,
        forkFromMessageId: input.messageId,
        title: input.title?.trim() || defaultTitle,
      },
    });

    await tx.conversation.update({
      where: { id: input.conversationId },
      data: { activeBranchId: created.id },
    });

    return created;
  });

  await invalidateConversationCaches({
    userId: user.id,
    conversationId: input.conversationId,
  });

  revalidatePath(`/c/${input.conversationId}`);
  return branch;
}

export async function renameBranch(branchId: string, title: string) {
  const user = await requireUser();
  const branch = await assertOwnsBranch(branchId, user.id);
  const nextTitle =
    title.trim() || (branch.parentBranchId == null ? "Main" : "Branch");

  const updated = await prisma.branch.update({
    where: { id: branchId },
    data: { title: nextTitle.slice(0, 80) },
  });

  revalidatePath(`/c/${branch.conversationId}`);
  return updated;
}

/**
 * Delete a non-root branch (descendants cascade). Falls back active branch to parent.
 */
export async function deleteBranch(branchId: string) {
  const user = await requireUser();
  const branch = await assertOwnsBranch(branchId, user.id);

  if (branch.parentBranchId == null) {
    throw new Error("Cannot delete the main branch");
  }

  const conversation = await prisma.conversation.findUniqueOrThrow({
    where: { id: branch.conversationId },
  });

  const fallbackId = branch.parentBranchId;

  const descendantIds = await prisma.branch.findMany({
    where: { conversationId: branch.conversationId },
    select: { id: true, parentBranchId: true },
  });

  // Collect this branch + descendants for timeline cache purge.
  const toPurge = new Set<string>([branchId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of descendantIds) {
      if (
        row.parentBranchId &&
        toPurge.has(row.parentBranchId) &&
        !toPurge.has(row.id)
      ) {
        toPurge.add(row.id);
        grew = true;
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.branch.delete({ where: { id: branchId } });

    if (conversation.activeBranchId === branchId) {
      await tx.conversation.update({
        where: { id: branch.conversationId },
        data: { activeBranchId: fallbackId },
      });
    }
  });

  await invalidateConversationCaches({
    userId: user.id,
    conversationId: branch.conversationId,
    branchIds: [...toPurge],
  });

  revalidatePath(`/c/${branch.conversationId}`);
  return {
    id: branchId,
    activeBranchId: fallbackId,
    conversationId: branch.conversationId,
  };
}

export async function setActiveBranch(
  conversationId: string,
  branchId: string
) {
  const user = await requireUser();
  await assertOwnsConversation(conversationId, user.id);
  const branch = await assertOwnsBranch(branchId, user.id);

  if (branch.conversationId !== conversationId) {
    throw new Error("Branch does not belong to this conversation");
  }

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { activeBranchId: branchId },
  });

  await invalidateConversationCaches({
    userId: user.id,
    conversationId,
  });

  revalidatePath(`/c/${conversationId}`);
  return { conversationId, branchId };
}

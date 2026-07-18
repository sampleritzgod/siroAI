"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/actions/require-user";
import { createShareToken } from "@/modules/conversation/utils/share-token";

async function assertOwner(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
    select: {
      id: true,
      activeBranchId: true,
      shareToken: true,
      shareBranchId: true,
      branches: {
        where: { parentBranchId: null },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  return conversation;
}

function resolveShareBranchId(conversation: {
  activeBranchId: string | null;
  branches: { id: string }[];
  shareBranchId?: string | null;
}) {
  return (
    conversation.activeBranchId ||
    conversation.branches[0]?.id ||
    null
  );
}

export type ShareState = {
  shareToken: string | null;
  shareEnabledAt: Date | null;
  shareBranchId: string | null;
  sharePath: string | null;
};

export async function getShareState(
  conversationId: string
): Promise<ShareState> {
  const user = await requireUser();
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id },
    select: {
      shareToken: true,
      shareEnabledAt: true,
      shareBranchId: true,
    },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  return {
    shareToken: conversation.shareToken,
    shareEnabledAt: conversation.shareEnabledAt,
    shareBranchId: conversation.shareBranchId,
    sharePath: conversation.shareToken
      ? `/s/${conversation.shareToken}`
      : null,
  };
}

export async function enableShare(conversationId: string): Promise<ShareState> {
  const user = await requireUser();
  const conversation = await assertOwner(conversationId, user.id);
  const shareBranchId = resolveShareBranchId(conversation);

  if (!shareBranchId) {
    throw new Error("Conversation has no branch to share");
  }

  const shareToken = conversation.shareToken ?? createShareToken();

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      shareToken,
      shareEnabledAt: new Date(),
      shareBranchId,
    },
    select: {
      shareToken: true,
      shareEnabledAt: true,
      shareBranchId: true,
    },
  });

  revalidatePath(`/c/${conversationId}`);
  return {
    ...updated,
    sharePath: updated.shareToken ? `/s/${updated.shareToken}` : null,
  };
}

export async function disableShare(conversationId: string): Promise<ShareState> {
  const user = await requireUser();
  await assertOwner(conversationId, user.id);

  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      shareToken: null,
      shareEnabledAt: null,
      shareBranchId: null,
    },
  });

  revalidatePath(`/c/${conversationId}`);
  return {
    shareToken: null,
    shareEnabledAt: null,
    shareBranchId: null,
    sharePath: null,
  };
}

export async function rotateShare(conversationId: string): Promise<ShareState> {
  const user = await requireUser();
  const conversation = await assertOwner(conversationId, user.id);
  const shareBranchId =
    resolveShareBranchId(conversation) ?? conversation.shareBranchId;

  if (!shareBranchId) {
    throw new Error("Conversation has no branch to share");
  }

  const updated = await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      shareToken: createShareToken(),
      shareEnabledAt: new Date(),
      shareBranchId,
    },
    select: {
      shareToken: true,
      shareEnabledAt: true,
      shareBranchId: true,
    },
  });

  revalidatePath(`/c/${conversationId}`);
  return {
    ...updated,
    sharePath: updated.shareToken ? `/s/${updated.shareToken}` : null,
  };
}

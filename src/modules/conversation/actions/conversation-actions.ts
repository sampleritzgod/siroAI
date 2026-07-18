"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CACHE_TTL, cacheKeys } from "@/lib/cache/keys";
import { invalidateConversationCaches } from "@/lib/cache/invalidate";
import { cacheGetJson, cacheSetJson } from "@/lib/cache/store";
import { prisma } from "@/lib/db";
import {
  DEFAULT_MODEL_ID,
  MODEL_REGISTRY,
} from "@/modules/ai/model-registry";
import { requireUser } from "@/modules/auth/actions/require-user";

export type ConversationListItem = {
  id: string;
  title: string;
  isPinned: boolean;
  isArchived: boolean;
  lastMessageAt: Date;
  activeBranchId: string | null;
  model: string | null;
};

type CachedConversationListItem = Omit<ConversationListItem, "lastMessageAt"> & {
  lastMessageAt: string;
};

async function assertConversationOwner(conversationId: string, userId: string) {
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId },
  });

  if (!conversation) {
    throw new Error("Conversation not found");
  }

  return conversation;
}

function reviveListItem(item: CachedConversationListItem): ConversationListItem {
  return {
    ...item,
    lastMessageAt: new Date(item.lastMessageAt),
  };
}

export async function listConversations(): Promise<ConversationListItem[]> {
  const user = await requireUser();
  const key = cacheKeys.convList(user.id);

  const cached = await cacheGetJson<CachedConversationListItem[]>(key);
  if (cached) {
    return cached.map(reviveListItem);
  }

  const rows = await prisma.conversation.findMany({
    where: {
      userId: user.id,
      isArchived: false,
    },
    orderBy: [{ isPinned: "desc" }, { lastMessageAt: "desc" }],
    select: {
      id: true,
      title: true,
      isPinned: true,
      isArchived: true,
      lastMessageAt: true,
      activeBranchId: true,
      model: true,
    },
  });

  const forCache: CachedConversationListItem[] = rows.map((row) => ({
    ...row,
    lastMessageAt: row.lastMessageAt.toISOString(),
  }));

  await cacheSetJson(key, forCache, CACHE_TTL.convList);
  return rows;
}

/** Archived chats (not cached — infrequent). */
export async function listArchivedConversations(): Promise<
  ConversationListItem[]
> {
  const user = await requireUser();

  return prisma.conversation.findMany({
    where: {
      userId: user.id,
      isArchived: true,
    },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      isPinned: true,
      isArchived: true,
      lastMessageAt: true,
      activeBranchId: true,
      model: true,
    },
  });
}

type CachedConversationMeta = {
  id: string;
  userId: string;
  title: string;
  model: string | null;
  systemPrompt: string | null;
  isPinned: boolean;
  isArchived: boolean;
  activeBranchId: string | null;
  rootBranchId: string | null;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
};

export async function getConversation(conversationId: string) {
  const user = await requireUser();
  const key = cacheKeys.convMeta(conversationId);

  const cached = await cacheGetJson<CachedConversationMeta>(key);
  if (cached && cached.userId === user.id) {
    return {
      id: cached.id,
      userId: cached.userId,
      title: cached.title,
      model: cached.model,
      systemPrompt: cached.systemPrompt,
      isPinned: cached.isPinned,
      isArchived: cached.isArchived,
      activeBranchId: cached.activeBranchId,
      lastMessageAt: new Date(cached.lastMessageAt),
      createdAt: new Date(cached.createdAt),
      updatedAt: new Date(cached.updatedAt),
      activeBranch: null,
      branches: cached.rootBranchId
        ? [
            {
              id: cached.rootBranchId,
              conversationId: cached.id,
              parentBranchId: null,
              forkFromMessageId: null,
              title: "Main",
              createdAt: new Date(cached.createdAt),
              updatedAt: new Date(cached.updatedAt),
            },
          ]
        : [],
    };
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, userId: user.id },
    include: {
      activeBranch: true,
      branches: {
        where: { parentBranchId: null },
        take: 1,
      },
    },
  });

  if (!conversation) {
    return null;
  }

  const meta: CachedConversationMeta = {
    id: conversation.id,
    userId: conversation.userId,
    title: conversation.title,
    model: conversation.model,
    systemPrompt: conversation.systemPrompt,
    isPinned: conversation.isPinned,
    isArchived: conversation.isArchived,
    activeBranchId: conversation.activeBranchId,
    rootBranchId: conversation.branches[0]?.id ?? null,
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
  };

  await cacheSetJson(key, meta, CACHE_TTL.convMeta);
  return conversation;
}

/**
 * Creates a conversation with a root branch and redirects to it.
 */
export async function startNewChat() {
  const user = await requireUser();

  const conversation = await prisma.$transaction(async (tx) => {
    const created = await tx.conversation.create({
      data: {
        userId: user.id,
        model: DEFAULT_MODEL_ID,
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

  await invalidateConversationCaches({ userId: user.id });
  revalidatePath("/");
  redirect(`/c/${conversation.id}`);
}

export async function updateConversation(input: {
  id: string;
  title?: string;
  isPinned?: boolean;
  isArchived?: boolean;
  model?: string;
}) {
  const user = await requireUser();
  await assertConversationOwner(input.id, user.id);

  const data: {
    title?: string;
    isPinned?: boolean;
    isArchived?: boolean;
    model?: string;
  } = {};

  if (typeof input.title === "string") {
    const title = input.title.trim();
    if (!title) {
      throw new Error("Title cannot be empty");
    }
    data.title = title.slice(0, 120);
  }

  if (typeof input.isPinned === "boolean") {
    data.isPinned = input.isPinned;
  }

  if (typeof input.isArchived === "boolean") {
    data.isArchived = input.isArchived;
  }

  if (typeof input.model === "string") {
    if (!MODEL_REGISTRY[input.model]) {
      throw new Error("Unknown model");
    }
    data.model = input.model;
  }

  await prisma.conversation.update({
    where: { id: input.id },
    data,
  });

  await invalidateConversationCaches({
    userId: user.id,
    conversationId: input.id,
  });

  revalidatePath("/");
  revalidatePath(`/c/${input.id}`);
}

export async function deleteConversation(id: string) {
  const user = await requireUser();
  await assertConversationOwner(id, user.id);

  const branches = await prisma.branch.findMany({
    where: { conversationId: id },
    select: { id: true },
  });

  await prisma.conversation.delete({
    where: { id },
  });

  await invalidateConversationCaches({
    userId: user.id,
    conversationId: id,
    branchIds: branches.map((branch) => branch.id),
  });

  revalidatePath("/");
  revalidatePath(`/c/${id}`);
}

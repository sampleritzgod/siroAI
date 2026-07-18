import {
  isFileUIPart,
  isTextUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai";
import type { MessageRole, Prisma } from "@/generated/prisma/client";
import { CACHE_TTL, cacheKeys } from "@/lib/cache/keys";
import { invalidateConversationCaches } from "@/lib/cache/invalidate";
import { cacheGetJson, cacheSetJson } from "@/lib/cache/store";
import { prisma } from "@/lib/db";
import { branchOwnedIdsAfter } from "@/modules/ai/message-truncate";
import { resolveBranchMessageRows } from "@/modules/conversation/utils/branch-timeline";

function getMessageText(message: UIMessage) {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("");
}

function getMessageContentSummary(message: UIMessage) {
  const text = getMessageText(message).trim();
  if (text) return text;

  const fileParts = message.parts.filter(isFileUIPart);
  const toolParts = message.parts.filter(isToolUIPart);

  const fileSummary = fileParts
    .map((part) => `[file:${part.filename ?? part.mediaType}]`)
    .join(" ");

  const toolSummary = toolParts
    .map((part) => {
      const name = part.type.startsWith("tool-")
        ? part.type.slice("tool-".length)
        : "tool";
      return `[tool:${name}]`;
    })
    .join(" ");

  return [fileSummary, toolSummary].filter(Boolean).join(" ");
}

function toUIMessageParts(
  parts: Prisma.JsonValue | null,
  content: string
): UIMessage["parts"] {
  const stored = parts as UIMessage["parts"] | null;
  if (Array.isArray(stored) && stored.length > 0) {
    return stored;
  }

  return [{ type: "text", text: content }];
}

function toUIRole(role: MessageRole): UIMessage["role"] {
  switch (role) {
    case "ASSISTANT":
      return "assistant";
    case "SYSTEM":
      return "system";
    case "USER":
    default:
      return "user";
  }
}

function toPrismaRole(role: UIMessage["role"]): MessageRole {
  switch (role) {
    case "assistant":
      return "ASSISTANT";
    case "system":
      return "SYSTEM";
    case "user":
    default:
      return "USER";
  }
}

function isDefaultTitle(title: string) {
  return title.trim().toLowerCase() === "new chat";
}

/** Drop incomplete tool parts so the next turn won't fail convertToModelMessages. */
function sanitizePartsForStorage(parts: UIMessage["parts"]): UIMessage["parts"] {
  return parts.filter((part) => {
    if (!isToolUIPart(part)) return true;
    return (
      part.state === "output-available" ||
      part.state === "output-error" ||
      part.state === "output-denied"
    );
  });
}

/**
 * Loads the resolved timeline for a branch (shared prefix + branch-owned suffix).
 * Cached under `branch:{id}:timeline` when Redis (or memory fallback) is available.
 */
export async function loadChatMessages(
  conversationId: string,
  branchId: string
): Promise<UIMessage[]> {
  const cacheKey = cacheKeys.branchTimeline(branchId);
  const cached = await cacheGetJson<UIMessage[]>(cacheKey);
  if (cached) {
    return cached;
  }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, conversationId },
  });

  if (!branch) {
    throw new Error("Branch not found");
  }

  const rows = await resolveBranchMessageRows(branchId);

  const messages = rows.map((row) => ({
    id: row.id,
    role: toUIRole(row.role),
    parts: toUIMessageParts(row.parts, row.content),
  }));

  await cacheSetJson(cacheKey, messages, CACHE_TTL.branchTimeline);
  return messages;
}

type SaveChatMessagesOptions = {
  updateTitle?: boolean;
};

/**
 * Upserts messages onto a branch. Never rewrites messages owned by another branch.
 */
export async function saveChatMessages(
  conversationId: string,
  branchId: string,
  messages: UIMessage[],
  options: SaveChatMessagesOptions = {}
) {
  const { updateTitle = true } = options;

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, conversationId },
    select: {
      id: true,
      conversation: { select: { userId: true } },
    },
  });

  if (!branch) {
    throw new Error("Branch not found");
  }

  const persistable = messages.filter((message) => {
    if (message.role === "system") return false;

    const parts = sanitizePartsForStorage(message.parts);
    const content = getMessageContentSummary({ ...message, parts });

    if (message.role === "assistant" && !content.trim() && parts.length === 0) {
      return false;
    }

    return true;
  });

  await prisma.$transaction(async (tx) => {
    if (persistable.length > 0) {
      const existingRows = await tx.message.findMany({
        where: { id: { in: persistable.map((m) => m.id) } },
        select: { id: true, branchId: true },
      });
      const existingById = new Map(
        existingRows.map((row) => [row.id, row.branchId])
      );

      for (const message of persistable) {
        const parts = sanitizePartsForStorage(message.parts);
        const content = getMessageContentSummary({ ...message, parts });
        const role = toPrismaRole(message.role);
        const hasToolParts = parts.some(isToolUIPart);

        const existingBranchId = existingById.get(message.id);
        if (existingBranchId && existingBranchId !== branchId) {
          continue;
        }

        await tx.message.upsert({
          where: { id: message.id },
          create: {
            id: message.id,
            conversationId,
            branchId,
            role,
            status: "COMPLETE",
            content,
            parts: parts as Prisma.InputJsonValue,
            metadata: hasToolParts
              ? ({ hasTools: true } as Prisma.InputJsonValue)
              : undefined,
          },
          update: {
            content,
            parts: parts as Prisma.InputJsonValue,
            status: "COMPLETE",
            ...(hasToolParts
              ? { metadata: { hasTools: true } as Prisma.InputJsonValue }
              : {}),
          },
        });
      }
    }

    const conversation = await tx.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: { title: true },
    });

    const firstUser = messages.find((message) => message.role === "user");
    const firstUserText = firstUser ? getMessageText(firstUser).trim() : "";

    await tx.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: new Date(),
        activeBranchId: branchId,
        title:
          updateTitle && isDefaultTitle(conversation.title) && firstUserText
            ? firstUserText.slice(0, 48)
            : conversation.title,
      },
    });
  });

  await invalidateConversationCaches({
    userId: branch.conversation.userId,
    conversationId,
    branchIds: [branchId],
  });
}

export function extractMessageText(message: UIMessage) {
  return getMessageText(message);
}

/**
 * Delete messages owned by this branch that appear after `afterMessageId`
 * on the resolved timeline. Never deletes ancestor-branch rows.
 */
export async function deleteBranchMessagesAfter(
  conversationId: string,
  branchId: string,
  afterMessageId: string
) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, conversationId },
    select: {
      id: true,
      conversation: { select: { userId: true } },
    },
  });

  if (!branch) {
    throw new Error("Branch not found");
  }

  const timeline = await resolveBranchMessageRows(branchId);
  const ids = branchOwnedIdsAfter(timeline, afterMessageId, branchId);

  if (ids.length === 0) {
    return { deleted: 0 };
  }

  const result = await prisma.message.deleteMany({
    where: {
      id: { in: ids },
      branchId,
      conversationId,
    },
  });

  await invalidateConversationCaches({
    userId: branch.conversation.userId,
    conversationId,
    branchIds: [branchId],
  });

  return { deleted: result.count };
}

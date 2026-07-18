import type { Branch, Message } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

export type BranchNode = Pick<
  Branch,
  | "id"
  | "conversationId"
  | "parentBranchId"
  | "forkFromMessageId"
  | "title"
  | "createdAt"
  | "updatedAt"
>;

export type TimelineMessage = Pick<
  Message,
  | "id"
  | "conversationId"
  | "branchId"
  | "role"
  | "status"
  | "content"
  | "parts"
  | "metadata"
  | "createdAt"
  | "updatedAt"
>;

/**
 * Build ancestry [root, ..., current] from an in-memory branch map.
 */
export function buildBranchAncestry(
  branchId: string,
  branchesById: Map<string, BranchNode>
): BranchNode[] {
  const chain: BranchNode[] = [];
  let currentId: string | null = branchId;

  while (currentId) {
    const branch = branchesById.get(currentId);
    if (!branch) {
      throw new Error("Branch not found");
    }
    chain.unshift(branch);
    currentId = branch.parentBranchId;
  }

  return chain;
}

/**
 * Resolve the visible timeline for a branch:
 * shared ancestor prefix up to each fork point + this branch's own messages.
 *
 * Pure — unit-tested without DB.
 */
export function resolveTimelineFromSegments(
  ancestry: BranchNode[],
  messagesByBranchId: Map<string, TimelineMessage[]>
): TimelineMessage[] {
  const resolved: TimelineMessage[] = [];

  for (let index = 0; index < ancestry.length; index++) {
    const branch = ancestry[index];
    const owned = messagesByBranchId.get(branch.id) ?? [];
    const isLast = index === ancestry.length - 1;

    if (isLast) {
      resolved.push(...owned);
      continue;
    }

    const nextForkId = ancestry[index + 1]?.forkFromMessageId;
    // null fork = share nothing from this ancestor (edit-from-start branches).
    if (nextForkId == null) {
      continue;
    }

    const forkIndex = owned.findIndex((message) => message.id === nextForkId);
    if (forkIndex >= 0) {
      resolved.push(...owned.slice(0, forkIndex + 1));
      continue;
    }

    // Fork message was owned by an earlier ancestor — keep prefix through it.
    const resolvedForkIndex = resolved.findIndex(
      (message) => message.id === nextForkId
    );
    if (resolvedForkIndex >= 0) {
      resolved.splice(resolvedForkIndex + 1);
      continue;
    }

    throw new Error("Invalid branch fork point");
  }

  const seen = new Set<string>();
  return resolved.filter((message) => {
    if (seen.has(message.id)) return false;
    seen.add(message.id);
    return true;
  });
}

/**
 * Loads the resolved timeline for a branch in two queries:
 * 1) all branches in the conversation
 * 2) all messages owned by ancestry branches
 */
export async function resolveBranchMessageRows(
  branchId: string
): Promise<TimelineMessage[]> {
  const leaf = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      id: true,
      conversationId: true,
      parentBranchId: true,
      forkFromMessageId: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!leaf) {
    throw new Error("Branch not found");
  }

  const conversationBranches = await prisma.branch.findMany({
    where: { conversationId: leaf.conversationId },
    select: {
      id: true,
      conversationId: true,
      parentBranchId: true,
      forkFromMessageId: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const branchesById = new Map(
    conversationBranches.map((branch) => [branch.id, branch])
  );
  const ancestry = buildBranchAncestry(branchId, branchesById);
  const ancestryIds = ancestry.map((branch) => branch.id);

  const messages = await prisma.message.findMany({
    where: { branchId: { in: ancestryIds } },
    orderBy: { createdAt: "asc" },
  });

  const messagesByBranchId = new Map<string, TimelineMessage[]>();
  for (const message of messages) {
    const list = messagesByBranchId.get(message.branchId) ?? [];
    list.push(message);
    messagesByBranchId.set(message.branchId, list);
  }

  return resolveTimelineFromSegments(ancestry, messagesByBranchId);
}

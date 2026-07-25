import { loadChatMessages } from "@/modules/ai/chat-store";
import { prisma } from "@/lib/db";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { isShareTokenFormat } from "@/modules/conversation/utils/share-token";

export type SharedConversationView = {
  title: string;
  messages: Awaited<ReturnType<typeof loadChatMessages>>;
  sharedAt: Date | null;
};

/**
 * Public read helper — no auth. Returns null when token is invalid/revoked.
 * Rate-limited by token to blunt scraping.
 */
export async function loadSharedConversation(
  token: string
): Promise<SharedConversationView | null> {
  if (!isShareTokenFormat(token)) {
    return null;
  }

  const limited = await rateLimit({
    scope: "share",
    userId: `token:${token.slice(0, 24)}`,
    ...RATE_LIMITS.share,
  });
  if (!limited.success) {
    return null;
  }

  const conversation = await prisma.conversation.findFirst({
    where: { shareToken: token },
    select: {
      id: true,
      title: true,
      shareEnabledAt: true,
      shareBranchId: true,
      activeBranchId: true,
      branches: {
        where: { parentBranchId: null },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!conversation) {
    return null;
  }

  const branchId =
    conversation.shareBranchId ||
    conversation.activeBranchId ||
    conversation.branches[0]?.id;

  if (!branchId) {
    return null;
  }

  const messages = await loadChatMessages(conversation.id, branchId);

  return {
    title: conversation.title,
    messages,
    sharedAt: conversation.shareEnabledAt,
  };
}

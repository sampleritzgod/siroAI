import { cacheDel } from "@/lib/cache/store";
import { cacheKeys } from "@/lib/cache/keys";

/**
 * Drop cached reads after conversation / branch / message mutations.
 */
export async function invalidateConversationCaches(input: {
  userId?: string;
  conversationId?: string;
  branchIds?: string[];
}) {
  const keys: string[] = [];

  if (input.userId) {
    keys.push(cacheKeys.convList(input.userId));
  }

  if (input.conversationId) {
    keys.push(cacheKeys.convMeta(input.conversationId));
  }

  for (const branchId of input.branchIds ?? []) {
    keys.push(cacheKeys.branchTimeline(branchId));
  }

  await cacheDel(...keys);
}

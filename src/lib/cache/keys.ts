/** Redis / memory cache key builders + TTLs (seconds). */

export const CACHE_TTL = {
  /** Sidebar conversation list */
  convList: 5 * 60,
  /** Conversation title / model / activeBranch */
  convMeta: 60 * 60,
  /** Resolved branch timeline (UIMessage[]) */
  branchTimeline: 15 * 60,
} as const;

export const cacheKeys = {
  convList: (userId: string) => `user:${userId}:convlist`,
  convMeta: (conversationId: string) => `conv:${conversationId}:meta`,
  branchTimeline: (branchId: string) => `branch:${branchId}:timeline`,
  rateLimit: (scope: string, userId: string) => `rl:${scope}:user:${userId}`,
} as const;

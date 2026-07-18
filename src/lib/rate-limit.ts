import { cacheKeys } from "@/lib/cache/keys";
import { getRedis } from "@/lib/cache/redis";

export type RateLimitResult = {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
};

type MemoryCounter = {
  count: number;
  resetAt: number;
};

const memoryCounters = new Map<string, MemoryCounter>();

/** Test helper — clears in-process counters. */
export function resetRateLimitMemoryForTests() {
  memoryCounters.clear();
}

function memoryLimit(
  key: string,
  limit: number,
  windowSeconds: number
): RateLimitResult {
  const now = Date.now();
  const existing = memoryCounters.get(key);

  if (!existing || existing.resetAt <= now) {
    const resetAt = now + windowSeconds * 1000;
    memoryCounters.set(key, { count: 1, resetAt });
    return {
      success: true,
      limit,
      remaining: limit - 1,
      reset: resetAt,
    };
  }

  existing.count += 1;
  const success = existing.count <= limit;
  return {
    success,
    limit,
    remaining: Math.max(0, limit - existing.count),
    reset: existing.resetAt,
  };
}

/**
 * Fixed-window rate limit (Redis INCR when configured, else in-process).
 */
export async function rateLimit(input: {
  scope: string;
  userId: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const key = cacheKeys.rateLimit(input.scope, input.userId);
  const redis = getRedis();

  if (redis) {
    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.expire(key, input.windowSeconds);
      }

      const ttl = await redis.ttl(key);
      const reset =
        Date.now() +
        (ttl > 0 ? ttl * 1000 : input.windowSeconds * 1000);

      return {
        success: count <= input.limit,
        limit: input.limit,
        remaining: Math.max(0, input.limit - count),
        reset,
      };
    } catch (error) {
      console.warn("[rate-limit] redis failed, using memory", error);
    }
  }

  return memoryLimit(key, input.limit, input.windowSeconds);
}

export const RATE_LIMITS = {
  chat: { limit: 40, windowSeconds: 60 },
  consensus: { limit: 8, windowSeconds: 60 },
} as const;

export function rateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    "X-RateLimit-Limit": String(result.limit),
    "X-RateLimit-Remaining": String(result.remaining),
    "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
  };
}

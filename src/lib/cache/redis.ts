import { Redis } from "@upstash/redis";

const globalForRedis = globalThis as unknown as {
  siroRedis: Redis | null | undefined;
};

/**
 * Upstash Redis when UPSTASH_REDIS_REST_URL + TOKEN are set; otherwise null.
 * Callers should fall back to the in-process store (see store.ts).
 */
export function getRedis(): Redis | null {
  if (globalForRedis.siroRedis !== undefined) {
    return globalForRedis.siroRedis;
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    globalForRedis.siroRedis = null;
    return null;
  }

  globalForRedis.siroRedis = new Redis({ url, token });
  return globalForRedis.siroRedis;
}

export function isRedisConfigured() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

/** Test helper — drop the cached client so env changes take effect. */
export function resetRedisClientForTests() {
  globalForRedis.siroRedis = undefined;
}

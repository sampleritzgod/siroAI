import { getRedis } from "@/lib/cache/redis";

type MemoryEntry = {
  value: string;
  expiresAt: number | null;
};

const memory = new Map<string, MemoryEntry>();

function memoryGet(key: string): string | null {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt != null && entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet(key: string, value: string, ttlSeconds?: number) {
  memory.set(key, {
    value,
    expiresAt:
      typeof ttlSeconds === "number" ? Date.now() + ttlSeconds * 1000 : null,
  });
}

function memoryDel(...keys: string[]) {
  for (const key of keys) {
    memory.delete(key);
  }
}

/**
 * JSON get with Redis → in-memory fallback (local / missing Upstash).
 */
export async function cacheGetJson<T>(key: string): Promise<T | null> {
  const redis = getRedis();

  try {
    if (redis) {
      const value = await redis.get<T>(key);
      return value ?? null;
    }
  } catch (error) {
    console.warn("[cache] redis get failed, using memory", error);
  }

  const raw = memoryGet(key);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    memoryDel(key);
    return null;
  }
}

/**
 * JSON set with optional TTL (seconds).
 */
export async function cacheSetJson(
  key: string,
  value: unknown,
  ttlSeconds?: number
): Promise<void> {
  const redis = getRedis();

  try {
    if (redis) {
      if (typeof ttlSeconds === "number") {
        await redis.set(key, value, { ex: ttlSeconds });
      } else {
        await redis.set(key, value);
      }
      return;
    }
  } catch (error) {
    console.warn("[cache] redis set failed, using memory", error);
  }

  memorySet(key, JSON.stringify(value), ttlSeconds);
}

export async function cacheDel(...keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  const redis = getRedis();

  try {
    if (redis) {
      await redis.del(...keys);
      return;
    }
  } catch (error) {
    console.warn("[cache] redis del failed, using memory", error);
  }

  memoryDel(...keys);
}

/** Test helper — clear in-memory store. */
export function clearMemoryCache() {
  memory.clear();
}

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { resetRedisClientForTests } from "@/lib/cache/redis";
import {
  rateLimit,
  resetRateLimitMemoryForTests,
} from "./rate-limit";

describe("rateLimit (memory fallback)", () => {
  const savedUrl = process.env.UPSTASH_REDIS_REST_URL;
  const savedToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  before(() => {
    // Force in-process path so CI/local Redis env cannot flake these tests.
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    resetRedisClientForTests();
    resetRateLimitMemoryForTests();
  });

  after(() => {
    if (savedUrl === undefined) {
      delete process.env.UPSTASH_REDIS_REST_URL;
    } else {
      process.env.UPSTASH_REDIS_REST_URL = savedUrl;
    }
    if (savedToken === undefined) {
      delete process.env.UPSTASH_REDIS_REST_TOKEN;
    } else {
      process.env.UPSTASH_REDIS_REST_TOKEN = savedToken;
    }
    resetRedisClientForTests();
    resetRateLimitMemoryForTests();
  });

  it("allows requests under the limit", async () => {
    const first = await rateLimit({
      scope: "test",
      userId: "u1",
      limit: 3,
      windowSeconds: 60,
    });
    assert.equal(first.success, true);
    assert.equal(first.remaining, 2);

    const second = await rateLimit({
      scope: "test",
      userId: "u1",
      limit: 3,
      windowSeconds: 60,
    });
    assert.equal(second.success, true);
    assert.equal(second.remaining, 1);
  });

  it("denies when the window is exhausted", async () => {
    for (let i = 0; i < 2; i++) {
      await rateLimit({
        scope: "test",
        userId: "u2",
        limit: 2,
        windowSeconds: 60,
      });
    }

    const denied = await rateLimit({
      scope: "test",
      userId: "u2",
      limit: 2,
      windowSeconds: 60,
    });
    assert.equal(denied.success, false);
    assert.equal(denied.remaining, 0);
  });

  it("scopes counters per user", async () => {
    await rateLimit({
      scope: "test",
      userId: "a",
      limit: 1,
      windowSeconds: 60,
    });
    const other = await rateLimit({
      scope: "test",
      userId: "b",
      limit: 1,
      windowSeconds: 60,
    });
    assert.equal(other.success, true);
  });
});

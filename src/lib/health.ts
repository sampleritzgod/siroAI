import { prisma } from "@/lib/db";
import { isRedisConfigured, getRedis } from "@/lib/cache/redis";
import { logger } from "@/lib/logger";
import { isProductionRuntime } from "@/lib/runtime";

/**
 * Shared readiness probe for /api/ready and startup validation.
 */
export async function checkReadiness() {
  const started = Date.now();
  const checks: Record<string, "ok" | "error" | "skipped"> = {
    database: "error",
    redis: "skipped",
    openai: "skipped",
    blob: "skipped",
    clerk: "skipped",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (error) {
    logger.error("ready_db_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (isRedisConfigured()) {
    try {
      const redis = getRedis();
      checks.redis = redis && (await redis.ping()) === "PONG" ? "ok" : "error";
    } catch {
      checks.redis = "error";
    }
  } else if (isProductionRuntime()) {
    checks.redis = "error";
  }

  if (process.env.OPENAI_API_KEY?.trim()) {
    checks.openai = "ok";
  } else if (isProductionRuntime()) {
    checks.openai = "error";
  }

  const blobConfigured = Boolean(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
      process.env.BLOB_STORE_ID?.trim()
  );
  if (blobConfigured) {
    checks.blob = "ok";
  } else if (process.env.VERCEL === "1") {
    checks.blob = "error";
  }

  if (
    process.env.CLERK_SECRET_KEY?.trim() &&
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()
  ) {
    checks.clerk = "ok";
  } else {
    checks.clerk = "error";
  }

  const requiredOk =
    checks.database === "ok" &&
    checks.redis !== "error" &&
    checks.openai !== "error" &&
    checks.blob !== "error" &&
    checks.clerk === "ok";

  return {
    ok: requiredOk,
    checks,
    uptimeMs: Math.round(process.uptime() * 1000),
    durationMs: Date.now() - started,
  };
}

import { prisma } from "@/lib/db";
import { isRedisConfigured, getRedis } from "@/lib/cache/redis";
import { logger } from "@/lib/logger";
import { isProductionRuntime } from "@/lib/runtime";
import { isS3Configured } from "@/modules/files/s3";
import { isVercelBlobConfigured } from "@/modules/files/storage";

/**
 * Shared readiness probe for /api/ready and startup validation.
 */
export async function checkReadiness() {
  const started = Date.now();
  const checks: Record<string, "ok" | "error" | "skipped"> = {
    database: "error",
    redis: "skipped",
    openai: "skipped",
    storage: "skipped",
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

  // S3 is the primary backend; Vercel Blob remains valid for legacy deploys.
  const storageConfigured = isS3Configured() || isVercelBlobConfigured();
  if (storageConfigured) {
    checks.storage = "ok";
  } else if (process.env.VERCEL === "1") {
    checks.storage = "error";
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
    checks.storage !== "error" &&
    checks.clerk === "ok";

  return {
    ok: requiredOk,
    checks,
    uptimeMs: Math.round(process.uptime() * 1000),
    durationMs: Date.now() - started,
  };
}

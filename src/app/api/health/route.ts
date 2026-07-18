import { prisma } from "@/lib/db";
import { isRedisConfigured, getRedis } from "@/lib/cache/redis";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness + dependency checks (public, no auth).
 */
export async function GET() {
  const started = Date.now();
  const checks: Record<string, "ok" | "error" | "skipped"> = {
    database: "error",
    redis: "skipped",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (error) {
    logger.error("health_db_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (isRedisConfigured()) {
    try {
      const redis = getRedis();
      if (redis) {
        const pong = await redis.ping();
        checks.redis = pong === "PONG" ? "ok" : "error";
      } else {
        checks.redis = "error";
      }
    } catch {
      checks.redis = "error";
    }
  }

  const healthy =
    checks.database === "ok" &&
    (checks.redis === "ok" || checks.redis === "skipped");

  return Response.json(
    {
      ok: healthy,
      checks,
      uptimeMs: Math.round(process.uptime() * 1000),
      durationMs: Date.now() - started,
    },
    { status: healthy ? 200 : 503 }
  );
}

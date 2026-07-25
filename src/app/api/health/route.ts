import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness (process up). Does not require Redis.
 */
export async function GET() {
  const started = Date.now();
  logger.debug("health_ping");
  return Response.json({
    ok: true,
    status: "alive",
    uptimeMs: Math.round(process.uptime() * 1000),
    durationMs: Date.now() - started,
  });
}

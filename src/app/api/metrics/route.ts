import { assertCronAuthorized } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { toErrorResponse, unauthorized } from "@/lib/errors";
import { getJobStats } from "@/modules/jobs/queue";
import { getSoftDeleteStorageMetrics } from "@/modules/notebook/purge";
import { metricsSnapshot } from "@/lib/metrics";

export const dynamic = "force-dynamic";

/**
 * GET /api/metrics — operational metrics (cron-secret protected).
 */
export async function GET(req: Request) {
  try {
    try {
      assertCronAuthorized(req);
    } catch {
      return toErrorResponse(unauthorized());
    }

    const [jobs, softDelete, sourceStatus, chunkCount] = await Promise.all([
      getJobStats(),
      getSoftDeleteStorageMetrics(),
      prisma.source.groupBy({
        by: ["indexingStatus"],
        _count: { _all: true },
      }),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM "DocumentChunk"
      `,
    ]);

    const indexing: Record<string, number> = {};
    for (const row of sourceStatus) {
      indexing[row.indexingStatus] = row._count._all;
    }

    return Response.json({
      ok: true,
      time: new Date().toISOString(),
      process: metricsSnapshot(),
      jobs,
      indexing,
      chunks: Number(chunkCount[0]?.count ?? 0),
      softDelete,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

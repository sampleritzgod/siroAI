import { assertCronAuthorized } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { toErrorResponse, unauthorized } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/jobs/dead — read-only list of DEAD jobs.
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function GET(req: Request) {
  try {
    try {
      assertCronAuthorized(req);
    } catch {
      return toErrorResponse(unauthorized());
    }

    const url = new URL(req.url);
    const limit = Math.min(
      Math.max(Number(url.searchParams.get("limit") ?? 50), 1),
      200
    );

    const dead = await prisma.backgroundJob.findMany({
      where: { status: "DEAD" },
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        type: true,
        status: true,
        idempotencyKey: true,
        attempts: true,
        maxAttempts: true,
        lastError: true,
        payload: true,
        progress: true,
        createdAt: true,
        updatedAt: true,
        completedAt: true,
      },
    });

    return Response.json({
      ok: true,
      count: dead.length,
      jobs: dead.map((job) => {
        const payload =
          job.payload &&
          typeof job.payload === "object" &&
          !Array.isArray(job.payload)
            ? (job.payload as Record<string, unknown>)
            : {};
        return {
          ...job,
          permanentlyFailed: Boolean(payload.permanentlyFailed),
          rescueCount: Number(payload.rescueCount ?? 0),
        };
      }),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

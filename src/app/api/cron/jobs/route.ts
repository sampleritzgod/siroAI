import { assertCronAuthorized } from "@/lib/cron-auth";
import { toErrorResponse, unauthorized } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { rescueDeadIndexJobs } from "@/modules/jobs/rescue";
import { getJobStats } from "@/modules/jobs/queue";
import { processJobs } from "@/modules/jobs/worker";
import { enqueueExpiredNotebookPurges } from "@/modules/notebook/purge";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * GET/POST /api/cron/jobs — drain durable job queue (Vercel Cron).
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function GET(req: Request) {
  return run(req);
}

export async function POST(req: Request) {
  return run(req);
}

async function run(req: Request) {
  try {
    try {
      assertCronAuthorized(req);
    } catch {
      return toErrorResponse(unauthorized());
    }

    const started = Date.now();
    const rescued = await rescueDeadIndexJobs();
    const purge = await enqueueExpiredNotebookPurges();
    const processed = await processJobs({ limit: 10 });
    const stats = await getJobStats();

    const body = {
      ok: true,
      rescued,
      purge,
      processed,
      stats,
      durationMs: Date.now() - started,
    };

    logger.info("cron_jobs_tick", body);
    return Response.json(body);
  } catch (error) {
    return toErrorResponse(error);
  }
}

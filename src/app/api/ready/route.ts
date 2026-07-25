import { checkReadiness } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/ready — readiness for load balancers (deps must be healthy).
 */
export async function GET() {
  const result = await checkReadiness();
  return Response.json(result, { status: result.ok ? 200 : 503 });
}

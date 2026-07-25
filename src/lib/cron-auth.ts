/**
 * Authenticate Vercel Cron / internal worker requests via CRON_SECRET.
 */
export function assertCronAuthorized(req: Request): void {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    // Local/dev without secret: allow only when not on Vercel production.
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("CRON_SECRET is not configured");
    }
    return;
  }

  const header = req.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length).trim()
    : null;
  const query = new URL(req.url).searchParams.get("secret");

  if (bearer === secret || query === secret) {
    return;
  }

  throw new Error("Unauthorized");
}

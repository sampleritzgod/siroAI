/**
 * Production dependency validation.
 * Runs once when the Next.js Node runtime starts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SKIP_ENV_VALIDATION === "true") return;

  const { isProductionRuntime } = await import("@/lib/runtime");
  if (!isProductionRuntime()) return;

  const missing: string[] = [];

  if (!process.env.DATABASE_URL?.trim()) missing.push("DATABASE_URL");
  if (!process.env.CLERK_SECRET_KEY?.trim()) missing.push("CLERK_SECRET_KEY");
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim()) {
    missing.push("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY");
  }
  if (!process.env.OPENAI_API_KEY?.trim()) missing.push("OPENAI_API_KEY");
  if (
    !process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    !process.env.UPSTASH_REDIS_REST_TOKEN?.trim()
  ) {
    missing.push("UPSTASH_REDIS_REST_URL/TOKEN");
  }
  if (
    !process.env.AWS_S3_BUCKET?.trim() ||
    !process.env.AWS_REGION?.trim() ||
    !process.env.AWS_ACCESS_KEY_ID?.trim() ||
    !process.env.AWS_SECRET_ACCESS_KEY?.trim()
  ) {
    if (
      !process.env.BLOB_READ_WRITE_TOKEN?.trim() &&
      !process.env.BLOB_STORE_ID?.trim()
    ) {
      missing.push(
        "AWS_S3_BUCKET (+ AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY) or BLOB_READ_WRITE_TOKEN/BLOB_STORE_ID"
      );
    }
  }
  if (!process.env.CRON_SECRET?.trim()) missing.push("CRON_SECRET");

  if (missing.length > 0) {
    const message = `[startup] Missing required production env: ${missing.join(", ")}`;
    console.error(message);
    throw new Error(message);
  }

  // Soft warnings — recommended but not fatal.
  if (!process.env.SENTRY_DSN?.trim()) {
    console.warn("[startup] SENTRY_DSN not set — exceptions will only be logged");
  }
  if (!process.env.SUPADATA_API_KEY?.trim()) {
    console.warn(
      "[startup] SUPADATA_API_KEY not set — YouTube sources may fail on Vercel"
    );
  }

  console.info("[startup] Production environment validation passed");
}

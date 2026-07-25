/**
 * Runtime helpers for production vs local/CI.
 */
export function isProductionRuntime() {
  return (
    process.env.VERCEL_ENV === "production" ||
    (process.env.NODE_ENV === "production" && process.env.VERCEL === "1")
  );
}

export function isVercelRuntime() {
  return process.env.VERCEL === "1";
}

/**
 * Normalizes DATABASE_URL for Prisma / node-postgres.
 * Strips whitespace and wrapping quotes (common Vercel paste mistake).
 */
export function getDatabaseUrl() {
  let url = process.env.DATABASE_URL?.trim() ?? "";

  if (
    (url.startsWith('"') && url.endsWith('"')) ||
    (url.startsWith("'") && url.endsWith("'"))
  ) {
    url = url.slice(1, -1).trim();
  }

  return ensureLibpqSslCompat(url);
}

/**
 * pg v8 warns that sslmode=require/prefer/verify-ca currently alias verify-full.
 * Opt into libpq-compatible semantics to silence the warning (Neon-safe).
 *
 * @see https://www.postgresql.org/docs/current/libpq-ssl.html
 */
function ensureLibpqSslCompat(url: string) {
  if (!url || /[?&]uselibpqcompat=/i.test(url)) {
    return url;
  }

  if (!/[?&]sslmode=(prefer|require|verify-ca)(&|$)/i.test(url)) {
    return url;
  }

  return url.includes("?")
    ? `${url}&uselibpqcompat=true`
    : `${url}?uselibpqcompat=true`;
}

/**
 * Ensures the connection string uses a scheme Prisma accepts.
 */
export function assertDatabaseUrl(url = getDatabaseUrl()) {
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add a postgresql:// connection string to your environment."
    );
  }

  if (!url.startsWith("postgresql://") && !url.startsWith("postgres://")) {
    const scheme = url.split(":")[0] || "(none)";
    throw new Error(
      `DATABASE_URL scheme "${scheme}" is invalid. Use a Postgres URL starting with postgresql:// or postgres://.`
    );
  }

  return url;
}

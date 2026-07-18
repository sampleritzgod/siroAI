import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { assertDatabaseUrl } from "@/lib/database-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Prisma + pg adapter.
 *
 * Connection pooling: prefer a pooled Neon / PgBouncer URL in production
 * (e.g. `?sslmode=require` + pooler host). Serverless functions should not
 * open unbounded direct connections — use the pooler endpoint from your host.
 */
function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: assertDatabaseUrl(),
  });

  return new PrismaClient({ adapter });
}

function getPrismaClient() {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}

/**
 * Lazy Prisma singleton — safe for Next.js build analysis (no connect on import).
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (prop === "then") return undefined;

    const client = getPrismaClient();
    const value = Reflect.get(client as object, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});

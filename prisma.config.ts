import { config } from "dotenv";
import { defineConfig } from "prisma/config";
import { getDatabaseUrl } from "./src/lib/database-url";

// Match Next.js: .env then .env.local (local wins).
config({ path: ".env" });
config({ path: ".env.local", override: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: getDatabaseUrl(),
  },
});

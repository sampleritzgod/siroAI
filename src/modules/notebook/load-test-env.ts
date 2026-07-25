import { config as loadEnv } from "dotenv";

/**
 * Side-effect import for notebook integration tests.
 * Loads .env / .env.local the same way prisma.config.ts does.
 */
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });
process.env.SKIP_ENV_VALIDATION ??= "true";

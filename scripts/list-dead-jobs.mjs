#!/usr/bin/env node
/**
 * List DEAD background jobs (read-only).
 *
 *   CRON_SECRET=... BASE_URL=https://… node scripts/list-dead-jobs.mjs
 *   # or against local with CRON_SECRET unset (dev allow):
 *   BASE_URL=http://localhost:3000 node scripts/list-dead-jobs.mjs
 */
const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
);
const secret = process.env.CRON_SECRET?.trim();

async function main() {
  const headers = {};
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const res = await fetch(`${BASE_URL}/api/admin/jobs/dead?limit=50`, {
    headers,
  });
  const body = await res.json();
  console.log(JSON.stringify({ status: res.status, ...body }, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

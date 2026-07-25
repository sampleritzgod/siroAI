/**
 * Lightweight load / latency benchmark against a running server.
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 pnpm load:test
 *
 * Measures health/ready concurrency — authenticated chat/upload require cookies
 * and are documented separately for staging runs.
 */

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
);

type Sample = { ok: boolean; ms: number; status: number };

async function hit(path: string): Promise<Sample> {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Accept: "application/json" },
    });
    return { ok: res.ok, ms: Date.now() - started, status: res.status };
  } catch {
    return { ok: false, ms: Date.now() - started, status: 0 };
  }
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx]!;
}

async function burst(path: string, concurrency: number, total: number) {
  const results: Sample[] = [];
  let next = 0;

  async function worker() {
    while (next < total) {
      const i = next;
      next += 1;
      results[i] = await hit(path);
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, () => worker())
  );
  return results;
}

function summarize(label: string, samples: Sample[]) {
  const times = samples.map((s) => s.ms);
  const ok = samples.filter((s) => s.ok).length;
  console.log(
    JSON.stringify({
      label,
      total: samples.length,
      ok,
      errorRate: Number(((1 - ok / samples.length) * 100).toFixed(2)),
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      p99: percentile(times, 99),
      max: Math.max(...times, 0),
    })
  );
}

async function main() {
  console.log(`Load test against ${BASE_URL}`);

  // Warmup
  await hit("/api/health");

  summarize("health x100 @25", await burst("/api/health", 25, 100));
  summarize("ready x100 @25", await burst("/api/ready", 25, 100));
  summarize("health x500 @100", await burst("/api/health", 100, 500));

  console.log(
    JSON.stringify({
      note: "Authenticated chat/upload load tests require a staging session cookie. Run k6/artillery against /api/chat with Clerk session for P95 chat latency.",
      recommendedStaging: {
        concurrentUsers: 100,
        concurrentChats: 500,
        simultaneousUploads: 50,
        largePdfs: 20,
      },
    })
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

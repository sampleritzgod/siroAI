type CounterMap = Map<string, number>;
type TimingMap = Map<string, number[]>;

const counters: CounterMap = new Map();
const timings: TimingMap = new Map();

/**
 * In-process metrics (per instance). Aggregated via logs + /api/metrics.
 */
export function incrMetric(name: string, by = 1) {
  counters.set(name, (counters.get(name) ?? 0) + by);
}

export function observeMs(name: string, durationMs: number) {
  const bucket = timings.get(name) ?? [];
  bucket.push(durationMs);
  // Cap memory per instance.
  if (bucket.length > 500) bucket.shift();
  timings.set(name, bucket);
}

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx]!;
}

export function metricsSnapshot() {
  const timingStats: Record<
    string,
    { count: number; p50: number; p95: number; p99: number }
  > = {};

  for (const [name, values] of timings) {
    const sorted = [...values].sort((a, b) => a - b);
    timingStats[name] = {
      count: sorted.length,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
    };
  }

  return {
    counters: Object.fromEntries(counters),
    timings: timingStats,
    memory: process.memoryUsage(),
    uptimeMs: Math.round(process.uptime() * 1000),
  };
}

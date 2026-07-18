import { MobileNavButton } from "@/components/mobile-nav-button";
import { getUsageSummary } from "@/modules/usage/actions";

export default async function UsagePage() {
  const summary = await getUsageSummary();
  const { last30Days, byKind, recent } = summary;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 sm:px-4">
        <MobileNavButton />
        <h1 className="text-sm font-semibold tracking-tight">Usage</h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
          <section>
            <h2 className="text-lg font-semibold tracking-tight">Last 30 days</h2>
            <p className="mt-1 text-sm text-[var(--muted)]">
              Approximate token and cost estimates for this account (not an
              invoice).
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Events" value={String(last30Days.events)} />
              <Stat
                label="Input tokens"
                value={last30Days.inputTokens.toLocaleString()}
              />
              <Stat
                label="Output tokens"
                value={last30Days.outputTokens.toLocaleString()}
              />
              <Stat
                label="Est. cost"
                value={`$${last30Days.estimatedCostUsd.toFixed(4)}`}
              />
            </dl>
          </section>

          {byKind.length > 0 ? (
            <section>
              <h2 className="text-sm font-semibold">By kind</h2>
              <ul className="mt-2 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
                {byKind.map((row) => (
                  <li
                    key={row.kind}
                    className="flex items-center justify-between px-3 py-2 text-sm"
                  >
                    <span>{row.kind}</span>
                    <span className="text-[var(--muted)]">
                      {row.events} events · {row.totalTokens.toLocaleString()}{" "}
                      tokens
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h2 className="text-sm font-semibold">Recent</h2>
            {recent.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--muted)]">
                No usage recorded yet. Send a chat message to start metering.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
                {recent.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-col gap-0.5 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span>
                      <span className="font-medium">{row.kind}</span>
                      <span className="text-[var(--muted)]"> · {row.model}</span>
                    </span>
                    <span className="text-[var(--muted)]">
                      {row.totalTokens.toLocaleString()} tok
                      {row.estimatedCostUsd != null
                        ? ` · $${row.estimatedCostUsd.toFixed(5)}`
                        : ""}
                      {" · "}
                      {row.createdAt.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <dt className="text-[11px] uppercase tracking-wide text-[var(--muted)]">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

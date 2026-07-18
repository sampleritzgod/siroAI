"use client";

import { useEffect, useState } from "react";
import { MobileNavButton } from "@/components/mobile-nav-button";
import { cn } from "@/lib/utils";
import type { ConsensusResult, PanelModelInfo } from "@/modules/consensus/types";

type MetaResponse = {
  ready: boolean;
  panel: PanelModelInfo[];
  evaluator: { modelId: string; label: string };
};

type Phase = "idle" | "running" | "done" | "error";

export function ConsensusView() {
  const [prompt, setPrompt] = useState("");
  const [meta, setMeta] = useState<MetaResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusLabel, setStatusLabel] = useState<string | null>(null);
  const [result, setResult] = useState<ConsensusResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/consensus")
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load consensus config");
        return (await response.json()) as MetaResponse;
      })
      .then(setMeta)
      .catch(() => {
        setError("Could not load consensus configuration.");
      });
  }, []);

  async function run() {
    const text = prompt.trim();
    if (!text || phase === "running") return;

    setError(null);
    setResult(null);
    setPhase("running");
    setStatusLabel("Asking models…");

    const statusTimer = setTimeout(() => {
      setStatusLabel("Synthesizing final answer…");
    }, 2_500);

    try {
      const response = await fetch("/api/consensus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });

      const data = (await response.json()) as ConsensusResult & {
        error?: string;
      };

      if (!response.ok && !data.panel?.length) {
        throw new Error(data.error || "Consensus request failed");
      }

      setResult(data);
      if (data.finalAnswer) {
        setPhase("done");
        setStatusLabel(null);
      } else {
        setPhase("error");
        setError(data.error || "Consensus did not produce a final answer.");
        setStatusLabel(null);
      }
    } catch (err) {
      setPhase("error");
      setStatusLabel(null);
      setError(err instanceof Error ? err.message : "Consensus request failed");
    } finally {
      clearTimeout(statusTimer);
    }
  }

  const busy = phase === "running";
  const panelPreview = meta?.panel ?? [];

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 sm:px-4">
        <MobileNavButton />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold tracking-tight">
            Self-Consistency
          </h1>
          <p className="truncate text-[11px] text-[var(--muted)]">
            Several OpenAI models answer → one synthesized final answer
          </p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-3 py-5 sm:px-4 sm:py-8">
          <section className="space-y-3">
            <label
              className="block text-sm font-medium"
              htmlFor="consensus-prompt"
            >
              Your question
            </label>
            <textarea
              id="consensus-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={busy}
              rows={4}
              placeholder="Ask something that benefits from multiple perspectives…"
              className="w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[15px] outline-none placeholder:text-[var(--muted)] disabled:opacity-50"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void run()}
                disabled={busy || !prompt.trim() || meta?.ready === false}
                className={cn(
                  "rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition",
                  "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                )}
              >
                {busy ? "Running…" : "Run consensus"}
              </button>
              {statusLabel ? (
                <span className="text-sm text-[var(--muted)]">
                  {statusLabel}
                </span>
              ) : null}
            </div>

            {meta ? (
              <p className="text-xs text-[var(--muted)]">
                Panel:{" "}
                {panelPreview.map((item) => item.label).join(" · ") || "—"}
                {meta.evaluator.label
                  ? ` · Evaluator: ${meta.evaluator.label}`
                  : ""}
                {!meta.ready ? " · Set OPENAI_API_KEY to enable." : ""}
              </p>
            ) : null}
          </section>

          {(busy || result) && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold tracking-tight">
                Model responses
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {result?.panel?.length
                  ? result.panel.map((item) => (
                      <article
                        key={item.modelId}
                        className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h3 className="text-sm font-medium">{item.label}</h3>
                          <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                            {item.provider}
                          </span>
                        </div>
                        {item.ok ? (
                          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                            {item.answer}
                          </pre>
                        ) : (
                          <p className="text-sm text-red-600">{item.error}</p>
                        )}
                      </article>
                    ))
                  : panelPreview.map((item) => (
                      <article
                        key={item.id}
                        className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h3 className="text-sm font-medium">{item.label}</h3>
                          <span className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
                            {item.provider}
                          </span>
                        </div>
                        <p className="text-sm text-[var(--muted)]">
                          Waiting for response…
                        </p>
                      </article>
                    ))}
              </div>
            </section>
          )}

          {result?.finalAnswer ? (
            <section className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold tracking-tight">
                  Synthesized final answer
                </h2>
                <span className="text-[11px] text-[var(--muted)]">
                  Evaluator: {result.evaluator.label}
                </span>
              </div>
              <div className="rounded-2xl border-2 border-[var(--accent)] bg-[var(--surface)] p-4 sm:p-5">
                <pre className="whitespace-pre-wrap font-sans text-[15px] leading-relaxed">
                  {result.finalAnswer}
                </pre>
              </div>
            </section>
          ) : null}

          {error ? (
            <p className="rounded-xl border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

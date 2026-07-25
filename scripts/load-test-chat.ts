/**
 * Authenticated / pipeline load test.
 *
 * Modes:
 * 1) Pipeline (default, no cookie): exercises embed + retrieve + OpenAI chat
 *    concurrency against the real DB — measures full RAG→LLM latency cliffs.
 * 2) HTTP chat: set SESSION_COOKIE + CONVERSATION_ID (+ optional BASE_URL)
 *    to hit POST /api/chat with a real Clerk session cookie.
 *
 * Usage:
 *   pnpm load:test:chat
 *   SESSION_COOKIE='__session=…' CONVERSATION_ID=… BASE_URL=https://… pnpm load:test:chat
 */

import "@/modules/notebook/load-test-env";

import { createIdGenerator, streamText } from "ai";
import { prisma } from "@/lib/db";
import { getLanguageModel } from "@/modules/ai/model-registry";
import { createNotebookForUser } from "@/modules/notebook/service";
import { retrieveRelevantChunks } from "@/modules/rag/retrieve";
import { createIndexedSourceFromUpload } from "@/modules/source/service";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
);
const SESSION_COOKIE = process.env.SESSION_COOKIE?.trim() || "";
const CONVERSATION_ID = process.env.CONVERSATION_ID?.trim() || "";

type Sample = {
  ok: boolean;
  ms: number;
  status: number;
  error?: string;
};

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[idx]!;
}

function summarize(label: string, samples: Sample[]) {
  const times = samples.map((s) => s.ms);
  const ok = samples.filter((s) => s.ok).length;
  const byStatus: Record<string, number> = {};
  for (const s of samples) {
    byStatus[String(s.status)] = (byStatus[String(s.status)] ?? 0) + 1;
  }
  const out = {
    label,
    total: samples.length,
    ok,
    errorRate: Number(((1 - ok / Math.max(samples.length, 1)) * 100).toFixed(2)),
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
    max: Math.max(...times, 0),
    byStatus,
  };
  console.log(JSON.stringify(out));
  return out;
}

async function burst<T>(
  concurrency: number,
  total: number,
  fn: (i: number) => Promise<T>
): Promise<T[]> {
  const results: T[] = [];
  let next = 0;
  async function worker() {
    while (next < total) {
      const i = next;
      next += 1;
      results[i] = await fn(i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function runHttpChatLoad() {
  console.log(
    JSON.stringify({
      mode: "http_chat",
      baseUrl: BASE_URL,
      conversationId: CONVERSATION_ID,
    })
  );

  const makeBody = (i: number) => ({
    id: CONVERSATION_ID,
    message: {
      id: createIdGenerator({ prefix: "msg", size: 12 })(),
      role: "user",
      parts: [{ type: "text", text: `Load test ping ${i}: what is in the notebook?` }],
    },
    trigger: "submit-message",
  });

  async function one(i: number): Promise<Sample> {
    const started = Date.now();
    try {
      const res = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: SESSION_COOKIE,
          Accept: "text/event-stream",
        },
        body: JSON.stringify(makeBody(i)),
      });
      // Drain stream so TTFT→complete is measured.
      await res.arrayBuffer();
      return {
        ok: res.ok,
        ms: Date.now() - started,
        status: res.status,
      };
    } catch (error) {
      return {
        ok: false,
        ms: Date.now() - started,
        status: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Ramp concurrency until cliff.
  for (const [concurrency, total] of [
    [5, 10],
    [10, 20],
    [20, 40],
    [40, 40],
  ] as const) {
    const samples = await burst(concurrency, total, one);
    const summary = summarize(`chat @${concurrency} x${total}`, samples);
    if (summary.errorRate > 20 || summary.p95 > 60_000) {
      console.log(
        JSON.stringify({
          cliff: true,
          concurrency,
          reason:
            summary.errorRate > 20
              ? "error_rate"
              : "p95_latency",
        })
      );
      break;
    }
  }
}

async function runPipelineLoad() {
  console.log(JSON.stringify({ mode: "pipeline_service" }));

  const suffix = `${Date.now()}`;
  const user = await prisma.user.create({
    data: {
      clerkId: `load_${suffix}`,
      email: `load-${suffix}@example.com`,
    },
  });

  try {
    const notebook = await createNotebookForUser({
      userId: user.id,
      title: "Load Test Notebook",
    });
    const source = await createIndexedSourceFromUpload({
      userId: user.id,
      notebookId: notebook.id,
      file: new File(
        [
          "Load test document about transformers, attention, and neural networks. ".repeat(
            40
          ),
        ],
        "load.txt",
        { type: "text/plain" }
      ),
    });

    const conv = await prisma.conversation.create({
      data: {
        userId: user.id,
        notebookId: notebook.id,
        model: "gpt-4o-mini",
        branches: { create: { title: "Main" } },
      },
      include: { branches: true },
    });
    await prisma.conversation.update({
      where: { id: conv.id },
      data: { activeBranchId: conv.branches[0]!.id },
    });

    async function one(i: number): Promise<Sample> {
      const started = Date.now();
      try {
        const chunks = await retrieveRelevantChunks({
          conversationId: conv.id,
          notebookId: notebook.id,
          query: `What does the document say about transformers? ping=${i}`,
          limit: 4,
        });

        const result = streamText({
          model: getLanguageModel("gpt-4o-mini"),
          system:
            "Answer briefly from context. If missing, say not present.",
          prompt: `Context:\n${chunks.map((c) => c.content).join("\n")}\n\nQuestion: summarize transformers in one sentence.`,
        });

        // Consume until first token + finish.
        let first = 0;
        for await (const part of result.fullStream) {
          if (!first && part.type === "text-delta") {
            first = Date.now() - started;
          }
        }
        return {
          ok: true,
          ms: Date.now() - started,
          status: 200,
          error: first ? `ttft=${first}` : undefined,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        const status = /429|rate/i.test(message)
          ? 429
          : /timeout/i.test(message)
            ? 504
            : 500;
        return {
          ok: false,
          ms: Date.now() - started,
          status,
          error: message.slice(0, 200),
        };
      }
    }

    console.log(
      JSON.stringify({
        setup: {
          userId: user.id,
          notebookId: notebook.id,
          sourceId: source.id,
          conversationId: conv.id,
        },
      })
    );

    for (const [concurrency, total] of [
      [5, 10],
      [10, 20],
      [20, 30],
      [40, 40],
    ] as const) {
      const samples = await burst(concurrency, total, one);
      const summary = summarize(
        `pipeline retrieve+llm @${concurrency} x${total}`,
        samples
      );
      if (summary.errorRate > 25 || summary.byStatus["429"]) {
        console.log(
          JSON.stringify({
            cliff: true,
            concurrency,
            bottleneck: summary.byStatus["429"]
              ? "openai_rate_limit"
              : "errors",
          })
        );
        break;
      }
    }
  } finally {
    await prisma.user.delete({ where: { id: user.id } }).catch(() => {});
  }
}

async function main() {
  if (SESSION_COOKIE && CONVERSATION_ID) {
    await runHttpChatLoad();
  } else {
    console.log(
      JSON.stringify({
        note: "SESSION_COOKIE + CONVERSATION_ID not set — running service-level pipeline load (embed+retrieve+LLM). For HTTP /api/chat, sign in, copy Cookie, set env vars.",
      })
    );
    await runPipelineLoad();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

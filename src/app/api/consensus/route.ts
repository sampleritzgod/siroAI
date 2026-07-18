import { auth } from "@clerk/nextjs/server";
import { createRequestId, captureException, logger } from "@/lib/logger";
import {
  RATE_LIMITS,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import { requireUser } from "@/modules/auth/actions/require-user";
import { runConsensus } from "@/modules/consensus/run-consensus";
import {
  canRunConsensus,
  listPanelModelInfo,
} from "@/modules/consensus/panel";
import { resolveEvaluatorModel } from "@/modules/consensus/evaluator";
import { recordUsageEvent } from "@/modules/usage/record-usage";

function jsonError(
  message: string,
  status: number,
  headers?: HeadersInit
) {
  return Response.json({ error: message }, { status, headers });
}

/**
 * GET /api/consensus — panel + evaluator metadata for the UI.
 */
export async function GET() {
  try {
    await auth.protect();

    let evaluator = { modelId: "", label: "" };
    try {
      const model = resolveEvaluatorModel();
      evaluator = { modelId: model.id, label: model.label };
    } catch {
      // no keys yet
    }

    return Response.json({
      ready: canRunConsensus(),
      panel: listPanelModelInfo(),
      evaluator,
    });
  } catch (error) {
    await captureException(error, { route: "api/consensus GET" });
    return jsonError("Unauthorized", 401);
  }
}

/**
 * POST /api/consensus — run self-consistency fan-out + synthesis.
 */
export async function POST(req: Request) {
  const requestId = createRequestId();

  try {
    const user = await requireUser();

    const limited = await rateLimit({
      scope: "consensus",
      userId: user.id,
      ...RATE_LIMITS.consensus,
    });

    if (!limited.success) {
      return jsonError("Too many consensus runs. Try again shortly.", 429, {
        ...rateLimitHeaders(limited),
        "Retry-After": String(
          Math.max(1, Math.ceil((limited.reset - Date.now()) / 1000))
        ),
      });
    }

    let body: { prompt?: string };
    try {
      body = await req.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const prompt = body.prompt?.trim() ?? "";
    if (!prompt) {
      return jsonError("Prompt is required", 400);
    }

    if (prompt.length > 8_000) {
      return jsonError("Prompt is too long (max 8000 characters)", 400);
    }

    if (!canRunConsensus()) {
      return jsonError(
        "Consensus needs at least two panel models. Set OPENAI_API_KEY.",
        503
      );
    }

    logger.info("consensus_start", { requestId, userId: user.id });

    const result = await runConsensus(prompt);

    const panelText = result.panel
      .map((item) => (item.ok ? item.answer : ""))
      .join("\n");
    const outputText = `${result.finalAnswer ?? ""}\n${panelText}`;
    const evaluatorModel =
      result.evaluator?.modelId ||
      (() => {
        try {
          return resolveEvaluatorModel().id;
        } catch {
          return "consensus";
        }
      })();

    await recordUsageEvent({
      userId: user.id,
      kind: "CONSENSUS",
      model: evaluatorModel,
      inputTokens: Math.ceil(prompt.length / 4) * (result.panel.length + 1),
      outputTokens: Math.ceil(outputText.length / 4),
      requestId,
      metadata: {
        panelCount: result.panel.length,
        successCount: result.panel.filter((item) => item.ok).length,
      },
    });

    if (result.error && !result.finalAnswer && result.panel.length === 0) {
      return Response.json(result, { status: 400 });
    }

    return Response.json(result);
  } catch (error) {
    await captureException(error, { requestId, route: "api/consensus POST" });
    const message =
      error instanceof Error ? error.message : "Internal server error";

    if (/unauthorized/i.test(message)) {
      return jsonError(message, 401);
    }

    return jsonError(message, 500);
  }
}

import { generateText } from "ai";
import { getLanguageModel } from "@/modules/ai/model-registry";
import {
  buildEvaluatorUserPrompt,
  EVALUATOR_SYSTEM_PROMPT,
  resolveEvaluatorModel,
} from "@/modules/consensus/evaluator";
import { canRunConsensus, resolvePanelModels } from "@/modules/consensus/panel";
import {
  EVALUATOR_TIMEOUT_MS,
  PANEL_TIMEOUT_MS,
  type ConsensusResult,
  type PanelAnswer,
  type PanelAnswerSuccess,
} from "@/modules/consensus/types";

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      reject(new Error(`${label} timed out after ${ms / 1000}s`));
    }, ms);
  });

  return Promise.race([promise, timeout]);
}

async function runPanelModel(
  modelId: string,
  label: string,
  provider: string,
  prompt: string
): Promise<PanelAnswer> {
  try {
    const result = await withTimeout(
      generateText({
        model: getLanguageModel(modelId),
        prompt,
        abortSignal: AbortSignal.timeout(PANEL_TIMEOUT_MS),
      }),
      PANEL_TIMEOUT_MS + 2_000,
      label
    );

    const answer = result.text?.trim() ?? "";
    if (!answer) {
      return {
        modelId,
        label,
        provider,
        ok: false,
        error: "Model returned an empty answer.",
      };
    }

    return {
      modelId,
      label,
      provider,
      ok: true,
      answer,
    };
  } catch (error) {
    return {
      modelId,
      label,
      provider,
      ok: false,
      error: error instanceof Error ? error.message : "Unknown panel error",
    };
  }
}

/**
 * Fan-out → collect → evaluate. Partial panel failures are allowed.
 */
export async function runConsensus(prompt: string): Promise<ConsensusResult> {
  const trimmed = prompt.trim();
  if (!trimmed) {
    return {
      prompt: "",
      panel: [],
      evaluator: { modelId: "", label: "" },
      finalAnswer: null,
      error: "Prompt is required.",
    };
  }

  if (!canRunConsensus()) {
    return {
      prompt: trimmed,
      panel: [],
      evaluator: { modelId: "", label: "" },
      finalAnswer: null,
      error:
        "Consensus needs at least two panel models. Set OPENAI_API_KEY (recommended) or another provider key.",
    };
  }

  const panelModels = resolvePanelModels();
  const evaluatorModel = resolveEvaluatorModel();

  const settled = await Promise.all(
    panelModels.map((model) =>
      runPanelModel(model.id, model.label, model.provider, trimmed)
    )
  );

  const successes = settled.filter(
    (item): item is PanelAnswerSuccess => item.ok
  );

  if (successes.length === 0) {
    return {
      prompt: trimmed,
      panel: settled,
      evaluator: {
        modelId: evaluatorModel.id,
        label: evaluatorModel.label,
      },
      finalAnswer: null,
      error: "All panel models failed. Fix API keys/quotas and try again.",
    };
  }

  try {
    const evaluation = await withTimeout(
      generateText({
        model: getLanguageModel(evaluatorModel.id),
        system: EVALUATOR_SYSTEM_PROMPT,
        prompt: buildEvaluatorUserPrompt(trimmed, successes),
        abortSignal: AbortSignal.timeout(EVALUATOR_TIMEOUT_MS),
      }),
      EVALUATOR_TIMEOUT_MS + 2_000,
      "Evaluator"
    );

    const finalAnswer = evaluation.text?.trim() ?? "";
    if (!finalAnswer) {
      return {
        prompt: trimmed,
        panel: settled,
        evaluator: {
          modelId: evaluatorModel.id,
          label: evaluatorModel.label,
        },
        finalAnswer: null,
        error: "Evaluator returned an empty answer.",
      };
    }

    return {
      prompt: trimmed,
      panel: settled,
      evaluator: {
        modelId: evaluatorModel.id,
        label: evaluatorModel.label,
      },
      finalAnswer,
      error: null,
    };
  } catch (error) {
    return {
      prompt: trimmed,
      panel: settled,
      evaluator: {
        modelId: evaluatorModel.id,
        label: evaluatorModel.label,
      },
      finalAnswer: null,
      error:
        error instanceof Error
          ? `Evaluator failed: ${error.message}`
          : "Evaluator failed.",
    };
  }
}

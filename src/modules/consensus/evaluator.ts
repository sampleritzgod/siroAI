import {
  hasProviderApiKey,
  MODEL_REGISTRY,
  type ModelDefinition,
} from "@/modules/ai/model-registry";
import type { PanelAnswerSuccess } from "@/modules/consensus/types";

/** Evaluator = OpenAI gpt-4o (works with only OPENAI_API_KEY). */
export function resolveEvaluatorModel(): ModelDefinition {
  if (hasProviderApiKey("openai")) {
    return MODEL_REGISTRY["openai:gpt-4o"];
  }

  if (hasProviderApiKey("anthropic")) {
    return MODEL_REGISTRY["anthropic:claude-sonnet-4"];
  }

  if (hasProviderApiKey("google")) {
    return MODEL_REGISTRY["google:gemini-2.0-flash"];
  }

  throw new Error("No evaluator model available. Set OPENAI_API_KEY.");
}

export const EVALUATOR_SYSTEM_PROMPT = [
  "You are an expert evaluator synthesizing multiple AI answers into one best response.",
  "You will receive the original user question and several candidate answers from different models.",
  "Your job:",
  "1) Compare the candidates carefully.",
  "2) Identify the strongest, most accurate, and most useful parts of each.",
  "3) Produce a single refined final answer that is better than any individual candidate.",
  "4) Do NOT simply copy one model's response verbatim.",
  "5) Resolve contradictions; prefer evidence, clarity, and correctness.",
  "6) When helpful, briefly note which models contributed useful ideas (by label).",
  "Return only the synthesized final answer for the user — clear and well structured.",
].join(" ");

export function buildEvaluatorUserPrompt(
  prompt: string,
  successes: PanelAnswerSuccess[]
) {
  const blocks = successes
    .map(
      (item, index) =>
        `### Candidate ${index + 1}: ${item.label} (${item.provider})\n${item.answer}`
    )
    .join("\n\n");

  return [
    "## Original user question",
    prompt,
    "",
    "## Candidate answers",
    blocks,
    "",
    "## Task",
    "Synthesize the best possible final answer from the candidates above.",
  ].join("\n");
}

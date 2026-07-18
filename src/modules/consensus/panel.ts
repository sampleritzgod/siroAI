import {
  hasProviderApiKey,
  MODEL_REGISTRY,
  type ModelDefinition,
} from "@/modules/ai/model-registry";
import type { PanelModelInfo } from "@/modules/consensus/types";

/**
 * Resolve which models sit on the consensus panel.
 *
 * Primary path (OpenAI only — what we ship with):
 *   gpt-4o-mini + gpt-4o + gpt-4.1-mini → then gpt-4o synthesizes.
 *
 * Extra providers are optional if keys appear later.
 */
export function resolvePanelModels(): ModelDefinition[] {
  const hasOpenAI = hasProviderApiKey("openai");
  const hasAnthropic = hasProviderApiKey("anthropic");
  const hasGoogle = hasProviderApiKey("google");

  const panel: ModelDefinition[] = [];

  if (hasOpenAI) {
    panel.push(MODEL_REGISTRY["openai:gpt-4o-mini"]);
    panel.push(MODEL_REGISTRY["openai:gpt-4o"]);
    panel.push(MODEL_REGISTRY["openai:gpt-4.1-mini"]);
  }

  // Optional extras — only if you add keys later (not required).
  if (hasAnthropic) {
    panel.push(MODEL_REGISTRY["anthropic:claude-sonnet-4"]);
  }
  if (hasGoogle) {
    panel.push(MODEL_REGISTRY["google:gemini-2.0-flash"]);
  }

  return panel.filter(Boolean);
}

export function listPanelModelInfo(): PanelModelInfo[] {
  return resolvePanelModels().map((model) => ({
    id: model.id,
    label: model.label,
    provider: model.provider,
  }));
}

export function canRunConsensus() {
  return resolvePanelModels().length >= 2;
}

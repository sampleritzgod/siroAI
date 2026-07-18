import { createAnthropic, type AnthropicProvider } from "@ai-sdk/anthropic";
import {
  createGoogleGenerativeAI,
  type GoogleGenerativeAIProvider,
} from "@ai-sdk/google";
import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";

export type ModelProvider = "openai" | "anthropic" | "google";

export type ModelCapabilities = {
  tools: boolean;
  vision: boolean;
  streaming: boolean;
};

export type ModelDefinition = {
  id: string;
  label: string;
  provider: ModelProvider;
  /** Provider-native model id passed to the SDK. */
  providerModelId: string;
  contextWindow: number;
  capabilities: ModelCapabilities;
};

/**
 * Single source of truth for chat models.
 * OpenAI models work with only OPENAI_API_KEY.
 * Anthropic / Google appear only when their keys are set.
 */
export const MODEL_REGISTRY: Record<string, ModelDefinition> = {
  "openai:gpt-4o-mini": {
    id: "openai:gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    providerModelId: "gpt-4o-mini",
    contextWindow: 128_000,
    capabilities: { tools: true, vision: true, streaming: true },
  },
  "openai:gpt-4o": {
    id: "openai:gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    providerModelId: "gpt-4o",
    contextWindow: 128_000,
    capabilities: { tools: true, vision: true, streaming: true },
  },
  "openai:gpt-4.1-mini": {
    id: "openai:gpt-4.1-mini",
    label: "GPT-4.1 mini",
    provider: "openai",
    providerModelId: "gpt-4.1-mini",
    contextWindow: 1_000_000,
    capabilities: { tools: true, vision: true, streaming: true },
  },
  "openai:gpt-4.1": {
    id: "openai:gpt-4.1",
    label: "GPT-4.1",
    provider: "openai",
    providerModelId: "gpt-4.1",
    contextWindow: 1_000_000,
    capabilities: { tools: true, vision: true, streaming: true },
  },
  "openai:o4-mini": {
    id: "openai:o4-mini",
    label: "o4-mini",
    provider: "openai",
    providerModelId: "o4-mini",
    contextWindow: 200_000,
    capabilities: { tools: true, vision: false, streaming: true },
  },
  "anthropic:claude-sonnet-4": {
    id: "anthropic:claude-sonnet-4",
    label: "Claude Sonnet 4",
    provider: "anthropic",
    providerModelId: "claude-sonnet-4-20250514",
    contextWindow: 200_000,
    capabilities: { tools: true, vision: true, streaming: true },
  },
  "anthropic:claude-haiku-3.5": {
    id: "anthropic:claude-haiku-3.5",
    label: "Claude Haiku 3.5",
    provider: "anthropic",
    providerModelId: "claude-3-5-haiku-latest",
    contextWindow: 200_000,
    capabilities: { tools: true, vision: true, streaming: true },
  },
  "google:gemini-2.0-flash": {
    id: "google:gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    provider: "google",
    providerModelId: "gemini-2.0-flash",
    contextWindow: 1_000_000,
    capabilities: { tools: true, vision: true, streaming: true },
  },
};

export const DEFAULT_MODEL_ID = "openai:gpt-4o-mini";

let openai: OpenAIProvider | undefined;
let anthropic: AnthropicProvider | undefined;
let google: GoogleGenerativeAIProvider | undefined;

export function hasProviderApiKey(provider: ModelProvider) {
  switch (provider) {
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY?.trim());
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
    case "google":
      return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim());
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/** @deprecated Prefer hasProviderApiKey("openai") */
export function hasOpenAIApiKey() {
  return hasProviderApiKey("openai");
}

function getOpenAI() {
  if (!openai) {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not configured on the server.");
    }
    openai = createOpenAI({ apiKey });
  }
  return openai;
}

function getAnthropic() {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured on the server.");
    }
    anthropic = createAnthropic({ apiKey });
  }
  return anthropic;
}

function getGoogle() {
  if (!google) {
    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "GOOGLE_GENERATIVE_AI_API_KEY is not configured on the server."
      );
    }
    google = createGoogleGenerativeAI({ apiKey });
  }
  return google;
}

export function resolveModelId(modelId?: string | null) {
  if (modelId && MODEL_REGISTRY[modelId]) {
    return modelId;
  }
  return DEFAULT_MODEL_ID;
}

export function getModelDefinition(modelId?: string | null): ModelDefinition {
  return MODEL_REGISTRY[resolveModelId(modelId)];
}

export function listModels(): ModelDefinition[] {
  return Object.values(MODEL_REGISTRY);
}

/** Models whose provider API key is configured on this server. */
export function listConfiguredModels(): ModelDefinition[] {
  return listModels().filter((model) => hasProviderApiKey(model.provider));
}

/**
 * Prefer the requested model when its provider key exists; otherwise fall back
 * to the first configured model (usually OpenAI when that's the only key).
 */
export function resolveConfiguredModelId(modelId?: string | null) {
  const requested = resolveModelId(modelId);
  const requestedDefinition = MODEL_REGISTRY[requested];

  if (
    requestedDefinition &&
    hasProviderApiKey(requestedDefinition.provider)
  ) {
    return requested;
  }

  return listConfiguredModels()[0]?.id ?? DEFAULT_MODEL_ID;
}

export function assertModelConfigured(modelId?: string | null) {
  const definition = getModelDefinition(resolveConfiguredModelId(modelId));
  if (!hasProviderApiKey(definition.provider)) {
    throw new Error(
      `${definition.label} requires ${definition.provider.toUpperCase()} API key on the server.`
    );
  }
  return definition;
}

/** Returns an AI SDK language model for the given registry id. */
export function getLanguageModel(modelId?: string | null) {
  const resolvedId = resolveConfiguredModelId(modelId);
  const resolved = assertModelConfigured(resolvedId);

  switch (resolved.provider) {
    case "openai":
      return getOpenAI()(resolved.providerModelId);
    case "anthropic":
      return getAnthropic()(resolved.providerModelId);
    case "google":
      return getGoogle()(resolved.providerModelId);
    default: {
      const _exhaustive: never = resolved.provider;
      throw new Error(`Unsupported provider: ${_exhaustive}`);
    }
  }
}

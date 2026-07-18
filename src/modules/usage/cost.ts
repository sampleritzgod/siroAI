/**
 * Rough USD estimates for metering UI (not billing-grade).
 * Prices are approximate public list rates — update as needed.
 */
const COST_PER_1M: Record<
  string,
  { input: number; output: number }
> = {
  "openai:gpt-4o-mini": { input: 0.15, output: 0.6 },
  "openai:gpt-4o": { input: 2.5, output: 10 },
  "openai:gpt-4.1-mini": { input: 0.4, output: 1.6 },
  "openai:gpt-4.1": { input: 2, output: 8 },
  "openai:o4-mini": { input: 1.1, output: 4.4 },
  "anthropic:claude-sonnet-4": { input: 3, output: 15 },
  "anthropic:claude-haiku-3.5": { input: 0.8, output: 4 },
  "google:gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

export function estimateCostUsd(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number | null {
  const rates =
    COST_PER_1M[input.model] ??
    (input.model.includes("embedding")
      ? COST_PER_1M["text-embedding-3-small"]
      : null);

  if (!rates) return null;

  const cost =
    (input.inputTokens / 1_000_000) * rates.input +
    (input.outputTokens / 1_000_000) * rates.output;

  return Math.round(cost * 1_000_000) / 1_000_000;
}

import type { UIMessage } from "ai";

/** Rough token estimate (~4 chars / token). Good enough for trimming. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateMessageTokens(message: UIMessage): number {
  let chars = 0;
  for (const part of message.parts) {
    if (part.type === "text" && "text" in part) {
      chars += part.text.length;
    } else {
      // Tool / file parts — approximate serialized size.
      chars += JSON.stringify(part).length;
    }
  }
  return Math.ceil(chars / 4);
}

export type TrimContextOptions = {
  /** Model context window (tokens). */
  contextWindow: number;
  /** Reserve for system prompt + model completion. */
  reservedTokens?: number;
  /** Cap on input tokens (overrides derived budget when smaller). */
  maxInputTokens?: number;
};

/**
 * Drop oldest messages until the estimated token budget fits.
 * Always keeps the newest message (current user turn).
 */
export function trimMessagesForContext(
  messages: UIMessage[],
  options: TrimContextOptions
): UIMessage[] {
  if (messages.length === 0) return messages;

  const reserved = options.reservedTokens ?? 4_096;
  const derived = Math.max(1_024, options.contextWindow - reserved);
  const budget = Math.min(
    derived,
    options.maxInputTokens ?? derived,
    Math.floor(options.contextWindow * 0.7)
  );

  let total = 0;
  for (const message of messages) {
    total += estimateMessageTokens(message);
  }

  if (total <= budget) {
    return messages;
  }

  const kept = [...messages];
  while (kept.length > 1 && total > budget) {
    const removed = kept.shift();
    if (removed) {
      total -= estimateMessageTokens(removed);
    }
  }

  return kept;
}

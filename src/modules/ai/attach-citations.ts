import type { UIMessage } from "ai";
import {
  CITATIONS_PART_TYPE,
  type MessageCitation,
} from "@/modules/rag/citation-types";

/**
 * Attach the turn's citations to the assistant message before persisting, so a
 * reload can still resolve inline `[n]` markers.
 *
 * Data parts are UI-only — convertToModelMessages ignores them, so this never
 * changes what later turns send to the model.
 */
export function withCitationsPart(
  messages: UIMessage[],
  citations: MessageCitation[]
): UIMessage[] {
  if (citations.length === 0) return messages;

  const lastAssistantIndex = messages.reduce(
    (found, message, index) => (message.role === "assistant" ? index : found),
    -1
  );
  if (lastAssistantIndex === -1) return messages;

  const target = messages[lastAssistantIndex];
  if (!target) return messages;
  if (target.parts.some((part) => part.type === CITATIONS_PART_TYPE)) {
    return messages;
  }

  const next = [...messages];
  next[lastAssistantIndex] = {
    ...target,
    parts: [
      ...target.parts,
      {
        type: CITATIONS_PART_TYPE,
        id: "citations",
        data: citations,
      } as UIMessage["parts"][number],
    ],
  };

  return next;
}

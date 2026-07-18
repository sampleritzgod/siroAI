import { generateText } from "ai";
import { invalidateConversationCaches } from "@/lib/cache/invalidate";
import { prisma } from "@/lib/db";
import { captureException, logger } from "@/lib/logger";
import {
  getLanguageModel,
  hasProviderApiKey,
} from "@/modules/ai/model-registry";

const TITLE_MODEL_ID = "openai:gpt-4o-mini";

/** True when the stored title is still the sync truncate / default. */
export function shouldReplaceAutoTitle(
  currentTitle: string,
  truncatedSource: string
) {
  const title = currentTitle.trim();
  if (!title || title.toLowerCase() === "new chat") {
    return true;
  }

  const truncated = truncatedSource.trim().slice(0, 48);
  return title === truncated;
}

export function sanitizeGeneratedTitle(raw: string) {
  const cleaned = raw
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim()
    .slice(0, 80);

  return cleaned || null;
}

/**
 * Best-effort LLM title polish. Safe to run inside `after()`.
 */
export async function generateConversationTitle(input: {
  conversationId: string;
  userId: string;
  sourceText: string;
  truncatedTitle: string;
}) {
  if (!hasProviderApiKey("openai")) {
    return;
  }

  const source = input.sourceText.trim().slice(0, 500);
  if (!source) {
    return;
  }

  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: input.conversationId, userId: input.userId },
      select: { id: true, title: true },
    });

    if (
      !conversation ||
      !shouldReplaceAutoTitle(conversation.title, input.truncatedTitle)
    ) {
      return;
    }

    const { text } = await generateText({
      model: getLanguageModel(TITLE_MODEL_ID),
      system:
        "Generate a short conversation title (3–8 words). No quotes, no trailing punctuation, no markdown.",
      prompt: source,
      maxOutputTokens: 40,
    });

    const nextTitle = sanitizeGeneratedTitle(text);
    if (!nextTitle) {
      return;
    }

    const fresh = await prisma.conversation.findFirst({
      where: { id: input.conversationId, userId: input.userId },
      select: { title: true },
    });

    if (
      !fresh ||
      !shouldReplaceAutoTitle(fresh.title, input.truncatedTitle)
    ) {
      return;
    }

    await prisma.conversation.update({
      where: { id: input.conversationId },
      data: { title: nextTitle },
    });

    await invalidateConversationCaches({
      userId: input.userId,
      conversationId: input.conversationId,
    });

    logger.info("conversation_title_polished", {
      conversationId: input.conversationId,
      title: nextTitle,
    });
  } catch (error) {
    await captureException(error, {
      conversationId: input.conversationId,
      stage: "generate_title",
    });
  }
}

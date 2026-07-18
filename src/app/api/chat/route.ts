import {
  consumeStream,
  convertToModelMessages,
  createIdGenerator,
  createUIMessageStreamResponse,
  isStepCount,
  isTextUIPart,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { createRequestId, captureException, logger } from "@/lib/logger";
import {
  RATE_LIMITS,
  rateLimit,
  rateLimitHeaders,
} from "@/lib/rate-limit";
import {
  deleteBranchMessagesAfter,
  extractMessageText,
  loadChatMessages,
  saveChatMessages,
} from "@/modules/ai/chat-store";
import { generateConversationTitle } from "@/modules/ai/generate-title";
import { trimMessagesForContext } from "@/modules/ai/context-window";
import {
  assertModelConfigured,
  getLanguageModel,
  getModelDefinition,
  resolveConfiguredModelId,
} from "@/modules/ai/model-registry";
import { DEFAULT_SYSTEM_PROMPT } from "@/modules/ai/prompts";
import { createChatTools } from "@/modules/ai/tools";
import { requireUser } from "@/modules/auth/actions/require-user";
import { prepareMessagesForModel } from "@/modules/files/prepare-messages";
import { conversationHasIndexedChunks } from "@/modules/rag/index-attachment";
import {
  formatRetrievedContext,
  retrieveRelevantChunks,
} from "@/modules/rag/retrieve";
import { recordUsageEvent } from "@/modules/usage/record-usage";

function jsonError(
  message: string,
  status: number,
  headers?: HeadersInit
) {
  return Response.json({ error: message }, { status, headers });
}

/**
 * POST /api/chat — Streams an assistant reply for a conversation branch.
 */
export async function POST(req: Request) {
  const requestId = createRequestId();

  try {
    let body: {
      message?: UIMessage;
      id?: string;
      branchId?: string;
      forceWebSearch?: boolean;
      trigger?: "submit-message" | "regenerate-message";
      messageId?: string;
    };

    try {
      body = await req.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const {
      message,
      id,
      branchId,
      forceWebSearch = false,
      trigger = "submit-message",
    } = body;

    if (!message || !id) {
      return jsonError("Missing message or conversation id", 400);
    }

    if (trigger === "regenerate-message" && message.role !== "user") {
      return jsonError("Regenerate requires the prior user message", 400);
    }

    const user = await requireUser();

    const limited = await rateLimit({
      scope: "chat",
      userId: user.id,
      ...RATE_LIMITS.chat,
    });

    if (!limited.success) {
      logger.warn("chat_rate_limited", { requestId, userId: user.id });
      return jsonError("Too many requests. Try again shortly.", 429, {
        ...rateLimitHeaders(limited),
        "Retry-After": String(
          Math.max(1, Math.ceil((limited.reset - Date.now()) / 1000))
        ),
      });
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id, userId: user.id },
    });

    if (!conversation) {
      return jsonError("Conversation not found", 404);
    }

    const modelId = resolveConfiguredModelId(conversation.model);

    try {
      assertModelConfigured(modelId);
    } catch (error) {
      return jsonError(
        error instanceof Error ? error.message : "Model not configured",
        503
      );
    }

    const modelDefinition = getModelDefinition(modelId);
    const toolsEnabled = modelDefinition.capabilities.tools;

    const resolvedBranchId =
      branchId ||
      conversation.activeBranchId ||
      (
        await prisma.branch.findFirst({
          where: { conversationId: id, parentBranchId: null },
          select: { id: true },
        })
      )?.id;

    if (!resolvedBranchId) {
      return jsonError("Branch not found", 404);
    }

    const branch = await prisma.branch.findFirst({
      where: { id: resolvedBranchId, conversationId: id },
    });

    if (!branch) {
      return jsonError("Branch not found", 404);
    }

    let previousMessages = await loadChatMessages(id, resolvedBranchId);

    if (trigger === "regenerate-message") {
      const keepUserId = message.id;
      const keepIndex = previousMessages.findIndex(
        (stored) => stored.id === keepUserId
      );

      if (keepIndex < 0) {
        return jsonError("Message not found on this branch", 404);
      }

      await deleteBranchMessagesAfter(id, resolvedBranchId, keepUserId);
      previousMessages = previousMessages.slice(0, keepIndex + 1);
    }

    const alreadySaved = previousMessages.some(
      (stored) => stored.id === message.id
    );

    const messages =
      trigger === "regenerate-message"
        ? previousMessages
        : alreadySaved
          ? previousMessages
          : [...previousMessages, message];

    if (trigger !== "regenerate-message" && !alreadySaved) {
      await saveChatMessages(id, resolvedBranchId, [message]);

      const isFirstUserTurn =
        message.role === "user" &&
        previousMessages.every((item) => item.role !== "user");

      if (isFirstUserTurn) {
        const sourceText = extractMessageText(message);
        const truncatedTitle = sourceText.trim().slice(0, 48);
        after(() =>
          generateConversationTitle({
            conversationId: id,
            userId: user.id,
            sourceText,
            truncatedTitle,
          })
        );
      }
    }

    const contextMessages = trimMessagesForContext(messages, {
      contextWindow: modelDefinition.contextWindow,
    });

    const modelReadyMessages = await prepareMessagesForModel(contextMessages, {
      visionEnabled: modelDefinition.capabilities.vision,
    });

    const tools = toolsEnabled
      ? createChatTools({ conversationId: id })
      : undefined;

    let ragContext = "";
    try {
      if (await conversationHasIndexedChunks(id)) {
        const latestUserText = [...messages]
          .reverse()
          .find((item) => item.role === "user")
          ?.parts.filter(isTextUIPart)
          .map((part) => part.text)
          .join("")
          .trim();

        if (latestUserText) {
          const chunks = await retrieveRelevantChunks({
            conversationId: id,
            query: latestUserText,
            limit: 6,
          });
          ragContext = formatRetrievedContext(chunks);
        }
      }
    } catch (error) {
      logger.warn("chat_rag_retrieve_failed", {
        requestId,
        conversationId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const modelMessages = await convertToModelMessages(modelReadyMessages, {
      tools,
      ignoreIncompleteToolCalls: true,
    });

    const baseSystem = conversation.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    const system = ragContext
      ? `${baseSystem}\n\n${ragContext}`
      : baseSystem;

    logger.info("chat_stream_start", {
      requestId,
      userId: user.id,
      conversationId: id,
      branchId: resolvedBranchId,
      modelId,
    });

    const result = streamText({
      model: getLanguageModel(modelId),
      system,
      messages: modelMessages,
      ...(tools
        ? {
            tools,
            prepareStep: ({ stepNumber }: { stepNumber: number }) => {
              if (forceWebSearch && stepNumber === 0) {
                return {
                  toolChoice: {
                    type: "tool" as const,
                    toolName: "webSearch" as const,
                  },
                };
              }
              return undefined;
            },
            stopWhen: isStepCount(5),
          }
        : {}),
      abortSignal: req.signal,
      onAbort: () => {
        logger.info("chat_stream_aborted", {
          requestId,
          conversationId: id,
        });
      },
      onFinish: async ({ totalUsage, finishReason }) => {
        const inputTokens = totalUsage?.inputTokens ?? 0;
        const outputTokens = totalUsage?.outputTokens ?? 0;

        await recordUsageEvent({
          userId: user.id,
          conversationId: id,
          kind: "CHAT",
          model: modelId,
          inputTokens,
          outputTokens,
          requestId,
          metadata: { finishReason, branchId: resolvedBranchId },
        });

        logger.info("chat_stream_finish", {
          requestId,
          conversationId: id,
          finishReason,
          inputTokens,
          outputTokens,
        });
      },
    });

    result.consumeStream();

    return createUIMessageStreamResponse({
      stream: toUIMessageStream({
        stream: result.stream,
        originalMessages: messages,
        generateMessageId: createIdGenerator({ prefix: "msg", size: 16 }),
        onEnd: async ({ messages: finalMessages }) => {
          try {
            await saveChatMessages(id, resolvedBranchId, finalMessages, {
              updateTitle: false,
            });
          } catch (error) {
            await captureException(error, {
              requestId,
              conversationId: id,
              stage: "persist",
            });
          }
        },
      }),
      consumeSseStream: consumeStream,
      headers: {
        "X-Request-Id": requestId,
      },
    });
  } catch (error) {
    await captureException(error, { requestId, route: "api/chat" });
    const message =
      error instanceof Error ? error.message : "Internal server error";

    if (/not found/i.test(message) || /unauthorized/i.test(message)) {
      return jsonError(message, /unauthorized/i.test(message) ? 401 : 404);
    }

    if (/rate|quota|429/i.test(message)) {
      return jsonError(
        "The model provider is rate-limiting requests. Try again in a moment.",
        429
      );
    }

    return jsonError(message, 500);
  }
}

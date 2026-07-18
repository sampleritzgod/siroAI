import type { Prisma, UsageKind } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { estimateCostUsd } from "@/modules/usage/cost";

export async function recordUsageEvent(input: {
  userId: string;
  conversationId?: string | null;
  kind: UsageKind;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  requestId?: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<void> {
  const inputTokens = Math.max(0, Math.floor(input.inputTokens ?? 0));
  const outputTokens = Math.max(0, Math.floor(input.outputTokens ?? 0));
  const totalTokens = inputTokens + outputTokens;

  if (totalTokens === 0 && input.kind !== "EMBEDDING") {
    return;
  }

  const estimatedCostUsd = estimateCostUsd({
    model: input.model,
    inputTokens,
    outputTokens,
  });

  try {
    await prisma.usageEvent.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId ?? null,
        kind: input.kind,
        model: input.model,
        inputTokens,
        outputTokens,
        totalTokens,
        estimatedCostUsd: estimatedCostUsd ?? undefined,
        requestId: input.requestId,
        metadata: input.metadata,
      },
    });
  } catch (error) {
    logger.warn("usage_record_failed", {
      error: error instanceof Error ? error.message : String(error),
      kind: input.kind,
      model: input.model,
    });
  }
}

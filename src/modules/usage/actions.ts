"use server";

import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/actions/require-user";

export type UsageSummary = {
  last30Days: {
    events: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  byKind: Array<{
    kind: string;
    events: number;
    totalTokens: number;
  }>;
  recent: Array<{
    id: string;
    kind: string;
    model: string;
    totalTokens: number;
    estimatedCostUsd: number | null;
    createdAt: Date;
  }>;
};

export async function getUsageSummary(): Promise<UsageSummary> {
  const user = await requireUser();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [aggregates, byKind, recent] = await Promise.all([
    prisma.usageEvent.aggregate({
      where: { userId: user.id, createdAt: { gte: since } },
      _count: { id: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        estimatedCostUsd: true,
      },
    }),
    prisma.usageEvent.groupBy({
      by: ["kind"],
      where: { userId: user.id, createdAt: { gte: since } },
      _count: { id: true },
      _sum: { totalTokens: true },
    }),
    prisma.usageEvent.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        kind: true,
        model: true,
        totalTokens: true,
        estimatedCostUsd: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    last30Days: {
      events: aggregates._count.id,
      inputTokens: aggregates._sum.inputTokens ?? 0,
      outputTokens: aggregates._sum.outputTokens ?? 0,
      totalTokens: aggregates._sum.totalTokens ?? 0,
      estimatedCostUsd: aggregates._sum.estimatedCostUsd ?? 0,
    },
    byKind: byKind.map((row) => ({
      kind: row.kind,
      events: row._count.id,
      totalTokens: row._sum.totalTokens ?? 0,
    })),
    recent,
  };
}

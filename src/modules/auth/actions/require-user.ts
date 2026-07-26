import { cache } from "react";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { onboard } from "@/modules/auth/actions/onboard";

/**
 * Returns the Prisma user for the signed-in Clerk session.
 *
 * Cached per React request so AppShell's parallel data loaders share one
 * auth.protect() + findUnique instead of repeating them.
 *
 * currentUser() / onboard() run only when the local row is missing.
 */
export const requireUser = cache(async () => {
  const { userId } = await auth.protect();

  const existing = await prisma.user.findUnique({
    where: { clerkId: userId },
  });

  if (existing) {
    return existing;
  }

  return onboard();
});

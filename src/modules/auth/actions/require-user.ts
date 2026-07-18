"use server";

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { onboard } from "@/modules/auth/actions/onboard";

/**
 * Returns the Prisma user for the signed-in Clerk session.
 *
 * Layout onboard() and page data can race — upsert when the lookup misses.
 */
export async function requireUser() {
  const { userId } = await auth.protect();

  const existing = await prisma.user.findUnique({
    where: { clerkId: userId },
  });

  if (existing) {
    return existing;
  }

  return onboard();
}

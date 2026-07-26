import { currentUser } from "@clerk/nextjs/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Creates the local Prisma User from Clerk profile data.
 *
 * Call only when findUnique by clerkId missed — never on every navigation.
 * Uses create (not upsert) so existing users never pay an update round-trip.
 * currentUser() hits Clerk's Backend API; keep it off the hot path.
 */
export async function onboard() {
  const clerkUser = await currentUser();

  if (!clerkUser) {
    throw new Error("Unauthorized");
  }

  const email = clerkUser.emailAddresses[0]?.emailAddress ?? null;

  try {
    return await prisma.user.create({
      data: {
        clerkId: clerkUser.id,
        email,
        firstName: clerkUser.firstName,
        lastName: clerkUser.lastName,
        imageUrl: clerkUser.imageUrl,
      },
    });
  } catch (error) {
    // Concurrent first requests can race on Unique(clerkId) / Unique(email).
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await prisma.user.findUnique({
        where: { clerkId: clerkUser.id },
      });
      if (existing) return existing;
    }
    throw error;
  }
}

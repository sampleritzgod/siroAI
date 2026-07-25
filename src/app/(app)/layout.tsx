import { auth } from "@clerk/nextjs/server";
import { AppShell } from "@/components/app-shell";
import { onboard } from "@/modules/auth/actions/onboard";

export const dynamic = "force-dynamic";

/**
 * Authenticated app shell — protects routes and syncs Clerk → Prisma user.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await auth.protect();
  await onboard();

  return <AppShell>{children}</AppShell>;
}

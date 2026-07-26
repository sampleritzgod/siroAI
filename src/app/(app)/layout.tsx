import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/modules/auth/actions/require-user";

export const dynamic = "force-dynamic";

/**
 * Authenticated app shell.
 * requireUser() (React.cache) protects the session and ensures a local
 * Prisma user exists — without calling currentUser() on every navigation.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();

  return <AppShell>{children}</AppShell>;
}

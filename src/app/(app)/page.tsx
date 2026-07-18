import { MobileNavButton } from "@/components/mobile-nav-button";
import { startNewChat } from "@/modules/conversation/actions/conversation-actions";
import { requireUser } from "@/modules/auth/actions/require-user";

export default async function HomePage() {
  const user = await requireUser();

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.email ||
    "there";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 md:hidden">
        <MobileNavButton />
        <span className="text-sm font-semibold tracking-tight">SiroAI</span>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 text-center sm:px-6">
        <div className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            SiroAI
          </p>
          <h1 className="max-w-xl text-2xl font-semibold tracking-tight sm:text-3xl md:text-4xl">
            Welcome, {displayName}
          </h1>
          <p className="max-w-md text-sm text-[var(--muted)] sm:text-base">
            Start a new chat to stream replies. Use the menu to browse
            conversations on mobile.
          </p>
        </div>

        <form action={startNewChat}>
          <button
            type="submit"
            className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
          >
            New chat
          </button>
        </form>
      </div>
    </div>
  );
}

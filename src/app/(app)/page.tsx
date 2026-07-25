import { MobileNavButton } from "@/components/mobile-nav-button";
import { requireUser } from "@/modules/auth/actions/require-user";
import { HomeNewChatButton } from "@/modules/notebook/components/home-new-chat-button";

export default async function HomePage() {
  await requireUser();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 lg:px-4">
        <MobileNavButton />
        <span className="text-sm font-semibold tracking-tight">Chat</span>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4 text-center sm:px-6">
        <div className="flex flex-col gap-2">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            SiroAI
          </p>
          <h1 className="max-w-md text-xl font-semibold tracking-tight sm:text-2xl">
            Start a conversation
          </h1>
          <p className="max-w-sm text-sm text-[var(--muted)]">
            Use a suggested question from the notebook dashboard, or begin a
            new chat here.
          </p>
        </div>

        <HomeNewChatButton />
      </div>
    </div>
  );
}

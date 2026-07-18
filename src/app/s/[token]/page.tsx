import { notFound } from "next/navigation";
import { ChatMessages } from "@/modules/conversation/components/chat-messages";
import { loadSharedConversation } from "@/modules/conversation/load-shared-conversation";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function SharedConversationPage({ params }: PageProps) {
  const { token } = await params;
  const shared = await loadSharedConversation(token);

  if (!shared) {
    notFound();
  }

  return (
    <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--border)] px-4 py-4">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-1">
          <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
            Shared from SiroAI
          </p>
          <h1 className="text-lg font-semibold tracking-tight">
            {shared.title}
          </h1>
          <p className="text-xs text-[var(--muted)]">
            Read-only view
            {shared.sharedAt
              ? ` · shared ${shared.sharedAt.toLocaleDateString()}`
              : ""}
          </p>
        </div>
      </header>

      <main className="pb-10">
        {shared.messages.length === 0 ? (
          <p className="mx-auto max-w-3xl px-4 py-10 text-sm text-[var(--muted)]">
            This conversation has no messages yet.
          </p>
        ) : (
          <ChatMessages messages={shared.messages} isThinking={false} />
        )}
      </main>
    </div>
  );
}

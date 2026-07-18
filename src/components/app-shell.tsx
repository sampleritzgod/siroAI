import { AppShellClient } from "@/components/app-shell-client";
import {
  listArchivedConversations,
  listConversations,
} from "@/modules/conversation/actions/conversation-actions";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const [conversations, archivedConversations] = await Promise.all([
    listConversations(),
    listArchivedConversations(),
  ]);

  return (
    <AppShellClient
      conversations={conversations}
      archivedConversations={archivedConversations}
    >
      {children}
    </AppShellClient>
  );
}

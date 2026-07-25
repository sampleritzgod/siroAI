import { AppShellClient } from "@/components/app-shell-client";
import {
  listArchivedConversations,
  listConversations,
} from "@/modules/conversation/actions/conversation-actions";
import { getUserNotebooks } from "@/modules/notebook/actions/notebook-actions";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const [notebooks, conversations, archivedConversations] = await Promise.all([
    getUserNotebooks(),
    listConversations(),
    listArchivedConversations(),
  ]);

  return (
    <AppShellClient
      notebooks={notebooks}
      conversations={conversations}
      archivedConversations={archivedConversations}
    >
      {children}
    </AppShellClient>
  );
}

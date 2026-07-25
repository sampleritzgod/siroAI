import { AppShellClient } from "@/components/app-shell-client";
import {
  listArchivedConversations,
  listConversations,
} from "@/modules/conversation/actions/conversation-actions";
import { getUserNotebooks } from "@/modules/notebook/actions/notebook-actions";
import { listAllSources } from "@/modules/source/actions/source-actions";

export async function AppShell({ children }: { children: React.ReactNode }) {
  const [notebooks, conversations, archivedConversations, sources] =
    await Promise.all([
      getUserNotebooks(),
      listConversations(),
      listArchivedConversations(),
      listAllSources(),
    ]);

  return (
    <AppShellClient
      notebooks={notebooks}
      conversations={conversations}
      archivedConversations={archivedConversations}
      sources={sources}
    >
      {children}
    </AppShellClient>
  );
}

"use client";

import { SidebarProvider } from "@/components/sidebar-context";
import type { ConversationListItem } from "@/modules/conversation/actions/conversation-actions";
import type { NotebookListItem } from "@/modules/notebook/actions/notebook-actions";
import { NotebookAppShell } from "@/modules/notebook/components/notebook-sidebar";

type AppShellClientProps = {
  notebooks: NotebookListItem[];
  conversations: ConversationListItem[];
  archivedConversations?: ConversationListItem[];
  children: React.ReactNode;
};

export function AppShellClient({
  notebooks,
  conversations,
  archivedConversations = [],
  children,
}: AppShellClientProps) {
  return (
    <SidebarProvider>
      <div className="relative flex h-dvh min-h-0 w-full overflow-hidden">
        <NotebookAppShell
          notebooks={notebooks}
          conversations={conversations}
          archivedConversations={archivedConversations}
        >
          {children}
        </NotebookAppShell>
      </div>
    </SidebarProvider>
  );
}

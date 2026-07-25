"use client";

import { SidebarProvider } from "@/components/sidebar-context";
import type { ConversationListItem } from "@/modules/conversation/actions/conversation-actions";
import { NotebookAppShell } from "@/modules/notebook/components/notebook-sidebar";
import type { NotebookListItem } from "@/modules/notebook/service";
import type { SourceListItem } from "@/modules/source/service";

type AppShellClientProps = {
  notebooks: NotebookListItem[];
  conversations: ConversationListItem[];
  archivedConversations?: ConversationListItem[];
  sources: SourceListItem[];
  children: React.ReactNode;
};

export function AppShellClient({
  notebooks,
  conversations,
  archivedConversations = [],
  sources,
  children,
}: AppShellClientProps) {
  return (
    <SidebarProvider>
      <div className="relative flex h-dvh min-h-0 w-full overflow-hidden">
        <NotebookAppShell
          notebooks={notebooks}
          conversations={conversations}
          archivedConversations={archivedConversations}
          sources={sources}
        >
          {children}
        </NotebookAppShell>
      </div>
    </SidebarProvider>
  );
}

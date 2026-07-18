"use client";

import { SidebarProvider } from "@/components/sidebar-context";
import { ConversationSidebar } from "@/modules/conversation/components/conversation-sidebar";
import type { ConversationListItem } from "@/modules/conversation/actions/conversation-actions";

type AppShellClientProps = {
  conversations: ConversationListItem[];
  archivedConversations?: ConversationListItem[];
  children: React.ReactNode;
};

export function AppShellClient({
  conversations,
  archivedConversations = [],
  children,
}: AppShellClientProps) {
  return (
    <SidebarProvider>
      <div className="relative flex h-dvh min-h-0 w-full overflow-hidden">
        <ConversationSidebar
          conversations={conversations}
          archivedConversations={archivedConversations}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}

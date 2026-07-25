"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { ConversationListItem } from "@/modules/conversation/actions/conversation-actions";
import {
  clearActiveNotebookId,
  readActiveNotebookId,
  resolveActiveNotebookId,
  subscribeActiveNotebook,
  writeActiveNotebookId,
} from "@/modules/notebook/active-notebook";
import { CreateNotebookDialog } from "@/modules/notebook/components/create-notebook-dialog";
import { NotebookEmptyState } from "@/modules/notebook/components/notebook-empty-state";
import { NotebookWorkspace } from "@/modules/notebook/components/notebook-workspace";
import type { NotebookListItem } from "@/modules/notebook/service";
import type { SourceListItem } from "@/modules/source/service";

type NotebookShellProps = {
  notebooks: NotebookListItem[];
  conversations: ConversationListItem[];
  archivedConversations?: ConversationListItem[];
  sources: SourceListItem[];
  children: React.ReactNode;
};

/**
 * NotebookLM-style shell: Sources | Chat | Studio for the active notebook.
 */
export function NotebookAppShell({
  notebooks,
  conversations,
  sources,
  children,
}: NotebookShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);

  const storedNotebookId = useSyncExternalStore(
    subscribeActiveNotebook,
    readActiveNotebookId,
    () => null
  );

  const conversationMatch = pathname.match(/^\/c\/([^/?#]+)/);
  const conversationId = conversationMatch?.[1];
  const conversationNotebookId = conversationId
    ? conversations.find((item) => item.id === conversationId)?.notebookId
    : undefined;

  const activeNotebookId = resolveActiveNotebookId(
    notebooks,
    conversationNotebookId ?? storedNotebookId
  );

  useEffect(() => {
    if (activeNotebookId && activeNotebookId !== storedNotebookId) {
      writeActiveNotebookId(activeNotebookId);
    }
    if (!activeNotebookId && storedNotebookId) {
      clearActiveNotebookId();
    }
  }, [activeNotebookId, storedNotebookId]);

  const activeNotebook = useMemo(
    () => notebooks.find((item) => item.id === activeNotebookId) ?? null,
    [notebooks, activeNotebookId]
  );

  const scopedSources = useMemo(
    () =>
      activeNotebookId
        ? sources.filter((item) => item.notebookId === activeNotebookId)
        : [],
    [sources, activeNotebookId]
  );

  const scopedConversations = useMemo(
    () =>
      activeNotebookId
        ? conversations.filter((item) => item.notebookId === activeNotebookId)
        : [],
    [conversations, activeNotebookId]
  );

  const showEmptyLibrary = notebooks.length === 0;
  const isWorkspaceRoute = pathname === "/" || pathname.startsWith("/c/");

  function selectNotebook(notebookId: string) {
    writeActiveNotebookId(notebookId);
    if (pathname.startsWith("/c/")) {
      router.push("/");
    }
  }

  function handleNotebookDeleted(deletedId: string) {
    const remaining = notebooks.filter((item) => item.id !== deletedId);
    const nextId = resolveActiveNotebookId(remaining, null);
    if (nextId) {
      writeActiveNotebookId(nextId);
    } else {
      clearActiveNotebookId();
    }
    if (pathname.startsWith("/c/")) {
      router.push("/");
    }
    router.refresh();
  }

  return (
    <>
      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {showEmptyLibrary ? (
          <NotebookEmptyState onCreate={() => setCreateOpen(true)} />
        ) : activeNotebook && isWorkspaceRoute ? (
          <NotebookWorkspace
            notebook={activeNotebook}
            notebooks={notebooks}
            sources={scopedSources}
            conversations={scopedConversations}
            onSelectNotebook={selectNotebook}
            onRequestCreateNotebook={() => setCreateOpen(true)}
            onNotebookDeleted={handleNotebookDeleted}
          >
            {children}
          </NotebookWorkspace>
        ) : (
          children
        )}
      </main>

      <CreateNotebookDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(notebookId) => {
          writeActiveNotebookId(notebookId);
          router.refresh();
        }}
      />
    </>
  );
}

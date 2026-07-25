"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import type { ConversationListItem } from "@/modules/conversation/actions/conversation-actions";
import {
  clearActiveNotebookId,
  readActiveNotebookId,
  resolveActiveNotebookId,
  subscribeActiveNotebook,
  writeActiveNotebookId,
} from "@/modules/notebook/active-notebook";
import { createNotebookQuick } from "@/modules/notebook/actions/notebook-actions";
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
  const [, startTransition] = useTransition();
  const [createError, setCreateError] = useState<string | null>(null);

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
    // Always return to notebook home so the workspace resumes that notebook's chat.
    router.push("/");
    router.refresh();
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

  function createFirstNotebook() {
    setCreateError(null);
    startTransition(() => {
      void createNotebookQuick()
        .then((created) => {
          writeActiveNotebookId(created.id);
          router.push("/");
          router.refresh();
        })
        .catch((error) => {
          setCreateError(
            error instanceof Error ? error.message : "Could not create notebook"
          );
        });
    });
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {showEmptyLibrary ? (
        <NotebookEmptyState
          onCreate={createFirstNotebook}
          error={createError}
        />
      ) : activeNotebook && isWorkspaceRoute ? (
        <NotebookWorkspace
          notebook={activeNotebook}
          notebooks={notebooks}
          sources={scopedSources}
          conversations={scopedConversations}
          onSelectNotebook={selectNotebook}
          onNotebookDeleted={handleNotebookDeleted}
        >
          {children}
        </NotebookWorkspace>
      ) : (
        children
      )}
    </main>
  );
}

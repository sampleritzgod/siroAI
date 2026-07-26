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
  readPendingNotebookId,
  resolveActiveNotebookId,
  subscribeActiveNotebook,
  writeActiveNotebookId,
  writePendingNotebookId,
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
 * NotebookLM-style shell: Sources | Chat for the active notebook.
 */
function latestConversationForNotebook(
  conversations: ConversationListItem[],
  notebookId: string
) {
  return [...conversations]
    .filter((item) => item.notebookId === notebookId)
    .sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime()
    )[0];
}

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
  const pendingNotebookId = useSyncExternalStore(
    subscribeActiveNotebook,
    readPendingNotebookId,
    () => null
  );

  const conversationMatch = pathname.match(/^\/c\/([^/?#]+)/);
  const conversationId = conversationMatch?.[1];
  const conversationNotebookId = conversationId
    ? conversations.find((item) => item.id === conversationId)?.notebookId
    : undefined;

  // Drop the pending override once navigation landed on the target notebook
  // (or on notebook home, which will auto-open that notebook's chat).
  useEffect(() => {
    if (!pendingNotebookId) return;
    if (
      pathname === "/" ||
      conversationNotebookId === pendingNotebookId
    ) {
      writePendingNotebookId(null);
    }
  }, [pendingNotebookId, pathname, conversationNotebookId]);

  const activeNotebookId = resolveActiveNotebookId(
    notebooks,
    pendingNotebookId ?? conversationNotebookId ?? storedNotebookId
  );

  useEffect(() => {
    // While a manual switch is in flight, do not let the still-visible
    // previous /c/… conversation rewrite localStorage back.
    if (pendingNotebookId) return;
    if (activeNotebookId && activeNotebookId !== storedNotebookId) {
      writeActiveNotebookId(activeNotebookId);
    }
    if (!activeNotebookId && storedNotebookId) {
      clearActiveNotebookId();
    }
  }, [activeNotebookId, storedNotebookId, pendingNotebookId]);

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
    // Already reading this notebook — don't bounce through notebook home just
    // to re-open the same chat.
    if (
      notebookId === activeNotebookId &&
      !pendingNotebookId &&
      pathname.startsWith("/c/") &&
      conversationNotebookId === notebookId
    ) {
      return;
    }

    writePendingNotebookId(notebookId);
    writeActiveNotebookId(notebookId);

    // Jump straight to that notebook's latest chat. Going via "/" while the URL
    // is still another notebook's /c/… lets the sync effect undo the selection.
    const latest = latestConversationForNotebook(conversations, notebookId);
    if (latest) {
      router.push(`/c/${latest.id}`);
    } else {
      router.push("/");
    }
  }

  function handleNotebookDeleted(deletedId: string) {
    const remaining = notebooks.filter((item) => item.id !== deletedId);
    const nextId = resolveActiveNotebookId(remaining, null);
    writePendingNotebookId(null);
    if (nextId) {
      writeActiveNotebookId(nextId);
    } else {
      clearActiveNotebookId();
    }
    if (pathname.startsWith("/c/")) {
      router.push("/");
    }
  }

  function createFirstNotebook() {
    setCreateError(null);
    startTransition(() => {
      void createNotebookQuick()
        .then((created) => {
          writeActiveNotebookId(created.id);
          router.push("/");
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

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import type { ConversationListItem } from "@/modules/conversation/actions/conversation-actions";
import { createConversation } from "@/modules/conversation/actions/conversation-actions";
import { NotebookIndexingStatus } from "@/modules/notebook/components/notebook-indexing-status";
import { NotebookOnboarding } from "@/modules/notebook/components/notebook-onboarding";
import { SourcesPanel } from "@/modules/notebook/components/sources-panel";
import {
  isNotebookIndexing,
  isNotebookReady,
} from "@/modules/notebook/notebook-readiness";
import type { NotebookListItem } from "@/modules/notebook/service";
import { listNotebookSources } from "@/modules/source/actions/source-actions";
import { AddSourceDialog } from "@/modules/source/components/add-source-dialog";
import type { SourceListItem } from "@/modules/source/service";

type MobilePanel = "sources" | "chat";

type NotebookWorkspaceProps = {
  notebook: NotebookListItem;
  notebooks: NotebookListItem[];
  sources: SourceListItem[];
  conversations: ConversationListItem[];
  onSelectNotebook: (notebookId: string) => void;
  onNotebookDeleted: (notebookId: string) => void;
  children: React.ReactNode;
};

export function NotebookWorkspace({
  notebook,
  notebooks,
  sources,
  conversations,
  onSelectNotebook,
  onNotebookDeleted,
  children,
}: NotebookWorkspaceProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isChatRoute = pathname.startsWith("/c/");
  // Fresh poll can beat a stale RSC payload after indexing finishes.
  const [pollNotebookId, setPollNotebookId] = useState(notebook.id);
  const [polledSources, setPolledSources] = useState<SourceListItem[] | null>(
    null
  );
  if (pollNotebookId !== notebook.id) {
    setPollNotebookId(notebook.id);
    setPolledSources(null);
  }
  // Prefer server props once they show INDEXED; otherwise use the live poll.
  const effectiveSources = isNotebookReady(sources)
    ? sources
    : (polledSources ?? sources);
  const ready = useMemo(
    () => isNotebookReady(effectiveSources),
    [effectiveSources]
  );
  const indexing = useMemo(
    () => isNotebookIndexing(effectiveSources),
    [effectiveSources]
  );
  // Every source failed: show the failure panel, not "this notebook is empty".
  const allFailed = useMemo(
    () =>
      effectiveSources.length > 0 &&
      effectiveSources.every((source) => source.indexingStatus === "FAILED"),
    [effectiveSources]
  );
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chat");
  const [openingChat, setOpeningChat] = useState(false);
  const [openChatError, setOpenChatError] = useState<string | null>(null);
  // Re-armed on route/notebook change so returning to a notebook resumes its
  // chat again instead of leaving a permanent "Loading chat…" spinner.
  const resumeAttempt = useRef<string | null>(null);
  // Never re-armed: at most one auto-created chat per notebook per session.
  const autoCreated = useRef(new Set<string>());
  // Force chat panel on conversation routes without a setState-in-effect.
  const activeMobilePanel: MobilePanel =
    ready && isChatRoute ? "chat" : mobilePanel;

  useEffect(() => {
    if (!ready && isChatRoute) {
      router.replace("/");
    }
  }, [ready, isChatRoute, router]);

  // Poll the DB directly while indexing. router.refresh() alone can leave a
  // stale layout payload on Vercel, so the spinner never exits even after
  // sources are INDEXED.
  useEffect(() => {
    if (isNotebookReady(sources)) return;
    // Nothing in flight (empty notebook, or every source FAILED) — don't poll.
    if (!isNotebookIndexing(sources)) return;

    let cancelled = false;

    async function tick() {
      try {
        const fresh = await listNotebookSources(notebook.id);
        if (cancelled) return;
        setPolledSources(fresh);
        if (isNotebookReady(fresh)) {
          router.refresh();
        }
      } catch {
        // Next tick retries.
      }
    }

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [notebook.id, sources, router]);

  useEffect(() => {
    resumeAttempt.current = null;
  }, [isChatRoute, notebook.id]);

  // After the first source is indexed, open chat automatically.
  // Users should not need a separate "New Chat" click to start.
  useEffect(() => {
    if (!ready || isChatRoute || openingChat) return;

    const latest = [...conversations].sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime()
    )[0];

    if (latest) {
      if (resumeAttempt.current === latest.id) return;
      resumeAttempt.current = latest.id;
      router.replace(`/c/${latest.id}`);
      return;
    }

    if (autoCreated.current.has(notebook.id)) return;
    autoCreated.current.add(notebook.id);
    setOpeningChat(true);
    setOpenChatError(null);

    void createConversation(notebook.id)
      .then((conversation) => {
        router.replace(`/c/${conversation.id}`);
        router.refresh();
      })
      .catch((error) => {
        autoCreated.current.delete(notebook.id);
        setOpenChatError(
          error instanceof Error ? error.message : "Could not open chat"
        );
      })
      .finally(() => {
        setOpeningChat(false);
      });
  }, [
    ready,
    isChatRoute,
    conversations,
    notebook.id,
    openingChat,
    router,
  ]);

  const setupContent = indexing || allFailed ? (
    <NotebookIndexingStatus
      sources={effectiveSources}
      onRefresh={() => {
        setPolledSources(null);
        router.refresh();
      }}
    />
  ) : (
    <NotebookOnboarding onAddSource={() => setAddSourceOpen(true)} />
  );

  const chatContent = (() => {
    if (!isChatRoute) {
      return (
        <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-[var(--background)] px-6 text-center">
          <span
            className="size-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
            aria-hidden="true"
          />
          <p className="text-sm text-[var(--muted)]">
            {openingChat ? "Opening chat…" : "Loading chat…"}
          </p>
          {openChatError ? (
            <p className="text-sm text-red-600" role="alert">
              {openChatError}
            </p>
          ) : null}
        </div>
      );
    }

    // During a notebook switch the URL can still point at the previous
    // notebook's conversation for one render — don't flash that chat.
    const routeMatch = pathname.match(/^\/c\/([^/?#]+)/);
    const routeConversationId = routeMatch?.[1];
    if (
      routeConversationId &&
      !conversations.some((item) => item.id === routeConversationId)
    ) {
      return (
        <div className="flex h-full min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-[var(--background)] px-6 text-center">
          <span
            className="size-6 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
            aria-hidden="true"
          />
          <p className="text-sm text-[var(--muted)]">Switching notebook…</p>
        </div>
      );
    }

    return children;
  })();

  const sourcesPanel = (
    <SourcesPanel
      notebook={notebook}
      notebooks={notebooks}
      sources={effectiveSources}
      conversations={conversations}
      onSelectNotebook={onSelectNotebook}
      onNotebookDeleted={onNotebookDeleted}
      variant={indexing ? "indexing" : "default"}
    />
  );

  if (!ready) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        {/* Fixed-width flex layout avoids the indexing panel overlapping the sidebar. */}
        <aside
          className="relative z-20 hidden h-full w-64 shrink-0 flex-col overflow-hidden border-r border-[var(--border)] bg-[var(--sidebar)] md:flex lg:w-72"
          aria-label="Sources"
        >
          {sourcesPanel}
        </aside>

        <section
          className="relative z-0 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--background)]"
          aria-label="Notebook setup"
        >
          {setupContent}
        </section>

        <AddSourceDialog
          open={addSourceOpen}
          notebookId={notebook.id}
          onClose={() => setAddSourceOpen(false)}
          onUploaded={() => {
            setAddSourceOpen(false);
            router.refresh();
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 border-b border-[var(--border)] md:hidden">
        {(
          [
            ["sources", "Sources"],
            ["chat", "Chat"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMobilePanel(id)}
            className={cn(
              "min-w-0 flex-1 px-3 py-2.5 text-sm font-medium",
              activeMobilePanel === id
                ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                : "text-[var(--muted)]"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        <section
          className={cn(
            "relative z-20 h-full w-full shrink-0 flex-col overflow-hidden border-[var(--border)] bg-[var(--sidebar)] md:w-64 md:border-r lg:w-72",
            activeMobilePanel === "sources" ? "flex" : "hidden md:flex"
          )}
          aria-label="Sources"
        >
          {sourcesPanel}
        </section>

        <section
          className={cn(
            "relative z-0 min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--background)]",
            activeMobilePanel === "chat" ? "flex" : "hidden md:flex"
          )}
          aria-label="Chat"
        >
          {chatContent}
        </section>
      </div>
    </div>
  );
}

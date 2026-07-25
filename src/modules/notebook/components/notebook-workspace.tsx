"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { NotebookChatWelcome } from "@/modules/notebook/components/notebook-chat-welcome";
import { NotebookIndexingStatus } from "@/modules/notebook/components/notebook-indexing-status";
import { NotebookOnboarding } from "@/modules/notebook/components/notebook-onboarding";
import { SourcesPanel } from "@/modules/notebook/components/sources-panel";
import { StudioPanel } from "@/modules/notebook/components/studio-panel";
import {
  isNotebookIndexing,
  isNotebookReady,
} from "@/modules/notebook/notebook-readiness";
import type { NotebookListItem } from "@/modules/notebook/service";
import { AddSourceDialog } from "@/modules/source/components/add-source-dialog";
import type { SourceListItem } from "@/modules/source/service";

type MobilePanel = "sources" | "chat" | "studio";

type NotebookWorkspaceProps = {
  notebook: NotebookListItem;
  notebooks: NotebookListItem[];
  sources: SourceListItem[];
  onSelectNotebook: (notebookId: string) => void;
  onRequestCreateNotebook: () => void;
  onNotebookDeleted: (notebookId: string) => void;
  children: React.ReactNode;
};

export function NotebookWorkspace({
  notebook,
  notebooks,
  sources,
  onSelectNotebook,
  onRequestCreateNotebook,
  onNotebookDeleted,
  children,
}: NotebookWorkspaceProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isChatRoute = pathname.startsWith("/c/");
  const ready = useMemo(() => isNotebookReady(sources), [sources]);
  const indexing = useMemo(() => isNotebookIndexing(sources), [sources]);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("chat");

  useEffect(() => {
    if (!ready && isChatRoute) {
      router.replace("/");
    }
  }, [ready, isChatRoute, router]);

  useEffect(() => {
    if (ready && isChatRoute) {
      setMobilePanel("chat");
    }
  }, [ready, isChatRoute]);

  useEffect(() => {
    if (!indexing) return;
    const timer = window.setInterval(() => {
      router.refresh();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [indexing, router]);

  const setupContent = indexing ? (
    <NotebookIndexingStatus sources={sources} />
  ) : (
    <NotebookOnboarding onAddSource={() => setAddSourceOpen(true)} />
  );

  const chatContent = isChatRoute ? (
    children
  ) : (
    <NotebookChatWelcome notebook={notebook} />
  );

  const sourcesPanel = (
    <SourcesPanel
      notebook={notebook}
      notebooks={notebooks}
      sources={sources}
      onSelectNotebook={onSelectNotebook}
      onRequestCreateNotebook={onRequestCreateNotebook}
      onNotebookDeleted={onNotebookDeleted}
    />
  );

  if (!ready) {
    return (
      <div className="flex h-full min-h-0 w-full min-w-0 flex-1 overflow-hidden">
        <div className="grid h-full min-h-0 w-full flex-1 grid-cols-1 md:grid-cols-[minmax(14rem,22%)_minmax(0,1fr)]">
          <section
            className="hidden min-h-0 min-w-0 overflow-hidden border-[var(--border)] md:flex md:border-r"
            aria-label="Sources"
          >
            {sourcesPanel}
          </section>

          <section
            className="flex min-h-0 min-w-0 flex-col overflow-hidden"
            aria-label="Notebook setup"
          >
            {setupContent}
          </section>
        </div>

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
            ["studio", "Studio"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMobilePanel(id)}
            className={cn(
              "min-w-0 flex-1 px-3 py-2.5 text-sm font-medium",
              mobilePanel === id
                ? "border-b-2 border-[var(--accent)] text-[var(--accent)]"
                : "text-[var(--muted)]"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[minmax(14rem,22%)_minmax(0,1fr)] lg:grid-cols-[minmax(14rem,22%)_minmax(0,1fr)_minmax(16rem,30%)]">
        <section
          className={cn(
            "min-h-0 min-w-0 flex-col overflow-hidden border-[var(--border)] md:border-r",
            mobilePanel === "sources" ? "flex" : "hidden md:flex"
          )}
          aria-label="Sources"
        >
          {sourcesPanel}
        </section>

        <section
          className={cn(
            "min-h-0 min-w-0 flex-col overflow-hidden",
            mobilePanel === "chat" ? "flex" : "hidden md:flex"
          )}
          aria-label="Chat"
        >
          {chatContent}
        </section>

        <section
          className={cn(
            "min-h-0 min-w-0 flex-col overflow-hidden border-[var(--border)] lg:border-l",
            mobilePanel === "studio" ? "flex" : "hidden lg:flex"
          )}
          aria-label="Studio"
        >
          <StudioPanel />
        </section>
      </div>
    </div>
  );
}

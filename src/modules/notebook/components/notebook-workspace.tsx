"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { NotebookChatWelcome } from "@/modules/notebook/components/notebook-chat-welcome";
import { SourcesPanel } from "@/modules/notebook/components/sources-panel";
import { StudioPanel } from "@/modules/notebook/components/studio-panel";
import type { NotebookListItem } from "@/modules/notebook/service";
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
  const isChatRoute = pathname.startsWith("/c/");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(
    isChatRoute ? "chat" : "chat"
  );

  useEffect(() => {
    if (isChatRoute) {
      setMobilePanel("chat");
    }
  }, [isChatRoute]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
              "flex-1 px-3 py-2.5 text-sm font-medium transition",
              mobilePanel === id
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
            "min-h-0 min-w-0 border-[var(--border)]",
            // Desktop ~22%, tablet keeps sources, mobile tabbed
            "md:flex md:w-[22%] md:shrink-0 md:border-r",
            mobilePanel === "sources" ? "flex w-full" : "hidden md:flex"
          )}
          aria-label="Sources"
        >
          <SourcesPanel
            notebook={notebook}
            notebooks={notebooks}
            sources={sources}
            onSelectNotebook={onSelectNotebook}
            onRequestCreateNotebook={onRequestCreateNotebook}
            onNotebookDeleted={onNotebookDeleted}
          />
        </section>

        <section
          className={cn(
            "min-h-0 min-w-0 flex-col",
            // Desktop ~48% (flex grows), tablet flex-1, mobile tabbed
            "md:flex md:flex-1",
            mobilePanel === "chat" ? "flex w-full flex-1" : "hidden md:flex"
          )}
          aria-label="Chat"
        >
          {isChatRoute ? children : <NotebookChatWelcome notebook={notebook} />}
        </section>

        <section
          className={cn(
            "min-h-0 min-w-0 border-[var(--border)]",
            // Desktop ~30%, tablet collapses, mobile tabbed
            "lg:flex lg:w-[30%] lg:shrink-0 lg:border-l",
            mobilePanel === "studio" ? "flex w-full" : "hidden lg:flex"
          )}
          aria-label="Studio"
        >
          <StudioPanel />
        </section>
      </div>
    </div>
  );
}

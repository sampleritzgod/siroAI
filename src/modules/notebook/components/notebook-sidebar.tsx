"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { UserButton } from "@clerk/nextjs";
import { useSidebar } from "@/components/sidebar-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import type { ConversationListItem } from "@/modules/conversation/actions/conversation-actions";
import { updateNotebook } from "@/modules/notebook/actions/notebook-actions";
import {
  clearActiveNotebookId,
  readActiveNotebookId,
  resolveActiveNotebookId,
  subscribeActiveNotebook,
  writeActiveNotebookId,
} from "@/modules/notebook/active-notebook";
import { CreateNotebookDialog } from "@/modules/notebook/components/create-notebook-dialog";
import { DeleteNotebookDialog } from "@/modules/notebook/components/delete-notebook-dialog";
import { NotebookDashboard } from "@/modules/notebook/components/notebook-dashboard";
import { NotebookEmptyState } from "@/modules/notebook/components/notebook-empty-state";
import type { NotebookListItem } from "@/modules/notebook/service";
import type { SourceListItem } from "@/modules/source/service";

type NotebookSidebarProps = {
  notebooks: NotebookListItem[];
  activeNotebookId: string | null;
  onActiveNotebookChange: (notebookId: string | null) => void;
  onRequestCreateNotebook: () => void;
};

export function NotebookSidebar({
  notebooks,
  activeNotebookId,
  onActiveNotebookChange,
  onRequestCreateNotebook,
}: NotebookSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { open, setOpen, close } = useSidebar();
  const [isPending, startTransition] = useTransition();
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);

  function selectNotebook(notebookId: string) {
    writeActiveNotebookId(notebookId);
    onActiveNotebookChange(notebookId);
    setMenuOpenId(null);
    close();
    if (pathname.startsWith("/c/")) {
      router.push("/");
    }
  }

  function run(action: () => Promise<void>) {
    startTransition(() => {
      void action().then(() => router.refresh());
    });
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close sidebar"
        onClick={() => setOpen(false)}
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(18rem,85vw)] flex-col border-r border-[var(--border)] bg-[var(--sidebar)] transition-transform duration-200 ease-out",
          "md:static md:z-0 md:w-64 md:translate-x-0 md:shrink-0",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          isPending && "opacity-90"
        )}
      >
        <div className="flex h-14 items-center justify-between gap-2 px-4">
          <Link
            href="/"
            className="text-lg font-semibold tracking-tight"
            onClick={close}
          >
            SiroAI
          </Link>
          <div className="flex items-center gap-1">
            <UserButton />
            <button
              type="button"
              aria-label="Close sidebar"
              onClick={() => setOpen(false)}
              className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface)] md:hidden"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 px-2 pb-3">
          <div className="flex flex-col gap-1">
            <p className="px-2 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
              Notebooks
            </p>

            <nav
              className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain"
              aria-label="Notebooks"
            >
              {notebooks.length === 0 ? (
                <div className="mx-1 rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-sm text-[var(--muted)]">
                  No notebooks yet
                </div>
              ) : (
                notebooks.map((notebook) => {
                  const active = notebook.id === activeNotebookId;
                  const renaming = renamingId === notebook.id;

                  return (
                    <div key={notebook.id} className="relative">
                      {renaming ? (
                        <form
                          className="px-1"
                          onSubmit={(event) => {
                            event.preventDefault();
                            run(async () => {
                              await updateNotebook({
                                id: notebook.id,
                                title: renameValue,
                              });
                              setRenamingId(null);
                            });
                          }}
                        >
                          <input
                            autoFocus
                            value={renameValue}
                            maxLength={100}
                            onChange={(event) =>
                              setRenameValue(event.target.value)
                            }
                            onBlur={() => setRenamingId(null)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") setRenamingId(null);
                            }}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none"
                          />
                        </form>
                      ) : (
                        <div
                          className={cn(
                            "group flex items-center rounded-lg",
                            active &&
                              "bg-[var(--accent)]/10 ring-1 ring-[var(--accent)]/30"
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => selectNotebook(notebook.id)}
                            className={cn(
                              "min-w-0 flex-1 truncate px-2 py-2.5 text-left text-sm sm:py-2",
                              active
                                ? "font-medium text-[var(--accent)]"
                                : "text-[var(--foreground)]/80 hover:text-[var(--foreground)]"
                            )}
                          >
                            {notebook.title}
                          </button>

                          <button
                            type="button"
                            aria-label={`Notebook menu for ${notebook.title}`}
                            onClick={() =>
                              setMenuOpenId(
                                menuOpenId === notebook.id ? null : notebook.id
                              )
                            }
                            className="mr-1 rounded px-1.5 py-1 text-[var(--muted)] opacity-100 transition hover:bg-[var(--border)]/40 md:opacity-0 md:group-hover:opacity-100"
                          >
                            ···
                          </button>
                        </div>
                      )}

                      {menuOpenId === notebook.id ? (
                        <div className="absolute right-1 top-9 z-20 w-36 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
                          <MenuButton
                            onClick={() => {
                              selectNotebook(notebook.id);
                            }}
                          >
                            Open
                          </MenuButton>
                          <MenuButton
                            onClick={() => {
                              setRenamingId(notebook.id);
                              setRenameValue(notebook.title);
                              setMenuOpenId(null);
                            }}
                          >
                            Rename
                          </MenuButton>
                          <MenuButton
                            danger
                            onClick={() => {
                              setDeleteTarget({
                                id: notebook.id,
                                title: notebook.title,
                              });
                              setMenuOpenId(null);
                            }}
                          >
                            Delete
                          </MenuButton>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </nav>

            <button
              type="button"
              onClick={onRequestCreateNotebook}
              className="mx-1 mt-1 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-left text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)]"
            >
              + New Notebook
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t border-[var(--border)] px-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <ThemeToggle />
            <span className="text-[11px] text-[var(--muted)]">Settings</span>
          </div>
          <div className="flex gap-2">
            <Link
              href="/consensus"
              onClick={close}
              className={cn(
                "flex-1 rounded-lg border px-2 py-1.5 text-center text-[11px] font-medium transition",
                pathname === "/consensus"
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              )}
            >
              Consensus
            </Link>
            <Link
              href="/usage"
              onClick={close}
              className={cn(
                "flex-1 rounded-lg border px-2 py-1.5 text-center text-[11px] font-medium transition",
                pathname === "/usage"
                  ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
              )}
            >
              Usage
            </Link>
          </div>
        </div>
      </aside>

      <DeleteNotebookDialog
        open={Boolean(deleteTarget)}
        notebookId={deleteTarget?.id ?? null}
        notebookTitle={deleteTarget?.title ?? ""}
        isOnlyNotebook={notebooks.length <= 1}
        onClose={() => setDeleteTarget(null)}
        onDeleted={(deletedId) => {
          const remaining = notebooks.filter((item) => item.id !== deletedId);
          onActiveNotebookChange(resolveActiveNotebookId(remaining, null));
          if (pathname.startsWith("/c/")) {
            router.push("/");
          }
          router.refresh();
        }}
      />
    </>
  );
}

function MenuButton({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "block w-full px-3 py-2 text-left text-sm hover:bg-[var(--sidebar)] sm:py-1.5",
        danger && "text-red-600"
      )}
    >
      {children}
    </button>
  );
}

type NotebookShellProps = {
  notebooks: NotebookListItem[];
  conversations: ConversationListItem[];
  archivedConversations?: ConversationListItem[];
  sources: SourceListItem[];
  children: React.ReactNode;
};

/**
 * Client shell piece: active notebook persistence + notebook workspace layout.
 */
export function NotebookAppShell({
  notebooks,
  conversations,
  archivedConversations = [],
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

  const scopedConversations = useMemo(
    () =>
      activeNotebookId
        ? conversations.filter((item) => item.notebookId === activeNotebookId)
        : [],
    [conversations, activeNotebookId]
  );

  const scopedArchived = useMemo(
    () =>
      activeNotebookId
        ? archivedConversations.filter(
            (item) => item.notebookId === activeNotebookId
          )
        : [],
    [archivedConversations, activeNotebookId]
  );

  const scopedSources = useMemo(
    () =>
      activeNotebookId
        ? sources.filter((item) => item.notebookId === activeNotebookId)
        : [],
    [sources, activeNotebookId]
  );

  const showEmptyLibrary = notebooks.length === 0 && pathname === "/";
  const isWorkspaceRoute = pathname === "/" || pathname.startsWith("/c/");
  const showDashboard = Boolean(activeNotebook) && isWorkspaceRoute;
  const isChatRoute = pathname.startsWith("/c/");

  return (
    <>
      <NotebookSidebar
        notebooks={notebooks}
        activeNotebookId={activeNotebookId}
        onActiveNotebookChange={(notebookId) => {
          if (notebookId) {
            writeActiveNotebookId(notebookId);
          } else {
            clearActiveNotebookId();
          }
        }}
        onRequestCreateNotebook={() => setCreateOpen(true)}
      />
      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {showEmptyLibrary ? (
          <NotebookEmptyState onCreate={() => setCreateOpen(true)} />
        ) : (
          <>
            {showDashboard && activeNotebook ? (
              <section
                className={cn(
                  "min-h-0 min-w-0 flex-col border-[var(--border)] bg-[var(--background)]",
                  // Mobile: dashboard on home, chat-only on conversation routes
                  isChatRoute ? "hidden lg:flex" : "flex",
                  "w-full lg:w-[min(28rem,42%)] lg:shrink-0 lg:border-r"
                )}
                aria-label="Notebook dashboard"
              >
                <NotebookDashboard
                  notebook={activeNotebook}
                  notebooks={notebooks}
                  sources={scopedSources}
                  conversations={scopedConversations}
                  archivedConversations={scopedArchived}
                  onNotebookDeleted={(deletedId) => {
                    const remaining = notebooks.filter(
                      (item) => item.id !== deletedId
                    );
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
                  }}
                />
              </section>
            ) : null}

            <section
              className={cn(
                "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
                // Mobile: hide the home empty pane while dashboard is the focus
                showDashboard && !isChatRoute && "hidden lg:flex"
              )}
              aria-label={isChatRoute ? "Chat" : "Workspace"}
            >
              {children}
            </section>
          </>
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

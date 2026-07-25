"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import type { ConversationListItem } from "@/modules/conversation/actions/conversation-actions";
import {
  createNotebookQuick,
  listDeletedNotebooks,
  restoreNotebook,
  updateNotebook,
} from "@/modules/notebook/actions/notebook-actions";
import { DeleteNotebookDialog } from "@/modules/notebook/components/delete-notebook-dialog";
import type { NotebookListItem } from "@/modules/notebook/service";
import {
  deleteSource,
  renameSource,
} from "@/modules/source/actions/source-actions";
import { AddSourceDialog } from "@/modules/source/components/add-source-dialog";
import { SourceMetadataDialog } from "@/modules/source/components/source-metadata-dialog";
import { SOURCE_TITLE_MAX_LENGTH } from "@/modules/source/constants";
import type { SourceListItem } from "@/modules/source/service";
import { formatIndexingStatus } from "@/modules/source/status-label";

type SourcesPanelProps = {
  notebook: NotebookListItem;
  notebooks: NotebookListItem[];
  sources: SourceListItem[];
  conversations: ConversationListItem[];
  onSelectNotebook: (notebookId: string) => void;
  onNotebookDeleted: (notebookId: string) => void;
};

export function SourcesPanel({
  notebook,
  notebooks,
  sources,
  conversations,
  onSelectNotebook,
  onNotebookDeleted,
}: SourcesPanelProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [renamingNotebookId, setRenamingNotebookId] = useState<string | null>(
    null
  );
  const [notebookTitle, setNotebookTitle] = useState(notebook.title);
  const [notebookMenuId, setNotebookMenuId] = useState<string | null>(null);
  const [deleteNotebook, setDeleteNotebook] = useState<NotebookListItem | null>(
    null
  );
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [metadataSource, setMetadataSource] = useState<SourceListItem | null>(
    null
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deletedNotebooks, setDeletedNotebooks] = useState<NotebookListItem[]>(
    []
  );
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    if (renamingNotebookId === notebook.id) {
      setNotebookTitle(notebook.title);
    }
  }, [notebook.id, notebook.title, renamingNotebookId]);

  useEffect(() => {
    let cancelled = false;
    void listDeletedNotebooks()
      .then((rows) => {
        if (!cancelled) setDeletedNotebooks(rows);
      })
      .catch(() => {
        if (!cancelled) setDeletedNotebooks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [notebooks]);

  const filteredSources = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return sources;
    return sources.filter((source) =>
      [source.title, source.originalFileName, source.type]
        .join(" ")
        .toLowerCase()
        .includes(needle)
    );
  }, [sources, query]);

  const sortedChats = useMemo(
    () =>
      [...conversations].sort(
        (a, b) =>
          new Date(b.lastMessageAt).getTime() -
          new Date(a.lastMessageAt).getTime()
      ),
    [conversations]
  );

  function run(action: () => Promise<void>) {
    startTransition(() => {
      void action().then(() => router.refresh());
    });
  }

  function createNotebookNow() {
    setCreateError(null);
    startTransition(() => {
      void createNotebookQuick()
        .then((created) => {
          onSelectNotebook(created.id);
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
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col bg-[var(--sidebar)]",
        isPending && "opacity-90"
      )}
    >
      <div className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3">
        <h2 className="text-sm font-semibold tracking-tight">Notebooks</h2>
        <button
          type="button"
          onClick={createNotebookNow}
          disabled={isPending}
          className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
        >
          + New
        </button>
      </div>

      <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-[var(--border)] px-2 py-2">
        <ul className="flex flex-col gap-0.5">
          {notebooks.map((item) => {
            const active = item.id === notebook.id;
            const renaming = renamingNotebookId === item.id;

            return (
              <li key={item.id} className="relative">
                {renaming ? (
                  <form
                    className="px-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      run(async () => {
                        await updateNotebook({
                          id: item.id,
                          title: notebookTitle,
                        });
                        setRenamingNotebookId(null);
                      });
                    }}
                  >
                    <input
                      autoFocus
                      value={notebookTitle}
                      maxLength={100}
                      onChange={(event) => setNotebookTitle(event.target.value)}
                      onBlur={() => setRenamingNotebookId(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setRenamingNotebookId(null);
                        }
                      }}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none"
                    />
                  </form>
                ) : (
                  <div
                    className={cn(
                      "group flex items-center rounded-lg",
                      active && "bg-[var(--surface)]"
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectNotebook(item.id)}
                      className={cn(
                        "min-w-0 flex-1 truncate px-2 py-2 text-left text-sm",
                        active
                          ? "font-medium text-[var(--foreground)]"
                          : "text-[var(--foreground)]/80 hover:text-[var(--foreground)]"
                      )}
                    >
                      {item.title}
                    </button>
                    <button
                      type="button"
                      aria-label={`Notebook menu for ${item.title}`}
                      onClick={() =>
                        setNotebookMenuId(
                          notebookMenuId === item.id ? null : item.id
                        )
                      }
                      className="mr-0.5 rounded px-1.5 py-1 text-[var(--muted)] opacity-100 transition hover:bg-[var(--border)]/40 md:opacity-0 md:group-hover:opacity-100"
                    >
                      ···
                    </button>
                  </div>
                )}

                {notebookMenuId === item.id ? (
                  <div className="absolute right-1 top-9 z-20 w-40 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
                    <MenuButton
                      onClick={() => {
                        setNotebookTitle(item.title);
                        setRenamingNotebookId(item.id);
                        setNotebookMenuId(null);
                      }}
                    >
                      Rename
                    </MenuButton>
                    <MenuButton
                      danger
                      onClick={() => {
                        setDeleteNotebook(item);
                        setNotebookMenuId(null);
                      }}
                    >
                      Hide
                    </MenuButton>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {createError ? (
          <p className="px-2 pt-2 text-[11px] text-red-600" role="alert">
            {createError}
          </p>
        ) : null}

        {deletedNotebooks.length > 0 ? (
          <div className="mt-2 border-t border-[var(--border)] pt-2">
            <button
              type="button"
              onClick={() => setShowHidden((value) => !value)}
              className="w-full px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              Hidden notebooks ({deletedNotebooks.length}){" "}
              {showHidden ? "▾" : "▸"}
            </button>
            {showHidden ? (
              <ul className="mt-1 flex flex-col gap-0.5">
                {deletedNotebooks.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center gap-1 rounded-lg px-2 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--muted)]">
                      {item.title}
                    </span>
                    <button
                      type="button"
                      className="shrink-0 text-[11px] text-[var(--accent)] hover:underline"
                      onClick={() => {
                        run(async () => {
                          const restored = await restoreNotebook(item.id);
                          onSelectNotebook(restored.id);
                        });
                      }}
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--border)] p-3">
        <p className="truncate text-xs font-medium text-[var(--muted)]">
          In “{notebook.title}”
        </p>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="w-full rounded-xl bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
        >
          + Add Source
        </button>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search sources"
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none placeholder:text-[var(--muted)]"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2">
        <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
          Sources
        </p>
        {filteredSources.length === 0 ? (
          <div className="mx-1 mb-3 rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-sm text-[var(--muted)]">
            {sources.length === 0
              ? "No sources yet"
              : "No sources match your search"}
          </div>
        ) : (
          <ul className="mb-4 flex flex-col gap-0.5">
            {filteredSources.map((source) => {
              const renaming = renamingId === source.id;
              return (
                <li key={source.id} className="relative">
                  {renaming ? (
                    <form
                      className="px-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        run(async () => {
                          await renameSource({
                            id: source.id,
                            title: renameValue,
                          });
                          setRenamingId(null);
                        });
                      }}
                    >
                      <input
                        autoFocus
                        value={renameValue}
                        maxLength={SOURCE_TITLE_MAX_LENGTH}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => setRenamingId(null)}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setRenamingId(null);
                        }}
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm outline-none"
                      />
                    </form>
                  ) : (
                    <div className="group flex items-start rounded-lg px-1 py-1.5 hover:bg-[var(--surface)]">
                      <button
                        type="button"
                        onClick={() => setMetadataSource(source)}
                        className="min-w-0 flex-1 px-1 text-left"
                      >
                        <p className="truncate text-sm text-[var(--foreground)]">
                          <span aria-hidden="true">
                            {source.type === "PDF" ? "📄 " : "📝 "}
                          </span>
                          {source.title}
                        </p>
                        <p
                          className={cn(
                            "truncate text-[11px]",
                            source.indexingStatus === "FAILED"
                              ? "text-red-600"
                              : source.indexingStatus === "PROCESSING"
                                ? "text-[var(--accent)]"
                                : "text-[var(--muted)]"
                          )}
                        >
                          {formatIndexingStatus(source.indexingStatus)}
                        </p>
                      </button>
                      <button
                        type="button"
                        aria-label={`Source menu for ${source.title}`}
                        onClick={() =>
                          setMenuOpenId(
                            menuOpenId === source.id ? null : source.id
                          )
                        }
                        className="mr-0.5 rounded px-1.5 py-1 text-[var(--muted)] opacity-100 transition hover:bg-[var(--border)]/40 md:opacity-0 md:group-hover:opacity-100"
                      >
                        ···
                      </button>
                    </div>
                  )}

                  {menuOpenId === source.id ? (
                    <div className="absolute right-1 top-9 z-20 w-40 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
                      <MenuButton
                        onClick={() => {
                          setMetadataSource(source);
                          setMenuOpenId(null);
                        }}
                      >
                        View metadata
                      </MenuButton>
                      <MenuButton
                        onClick={() => {
                          setRenamingId(source.id);
                          setRenameValue(source.title);
                          setMenuOpenId(null);
                        }}
                      >
                        Rename
                      </MenuButton>
                      <MenuButton
                        danger
                        onClick={() => {
                          setMenuOpenId(null);
                          if (
                            !window.confirm(
                              `Delete “${source.title}”? The file and extracted text will be removed.`
                            )
                          ) {
                            return;
                          }
                          setDeleteError(null);
                          run(async () => {
                            try {
                              await deleteSource(source.id);
                            } catch (error) {
                              setDeleteError(
                                error instanceof Error
                                  ? error.message
                                  : "Could not delete source"
                              );
                            }
                          });
                        }}
                      >
                        Delete
                      </MenuButton>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
          Chats
        </p>
        {sortedChats.length === 0 ? (
          <div className="mx-1 rounded-lg border border-dashed border-[var(--border)] px-3 py-6 text-center text-sm text-[var(--muted)]">
            No chats yet
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sortedChats.map((chat) => {
              const active = pathname === `/c/${chat.id}`;
              return (
                <li key={chat.id}>
                  <Link
                    href={`/c/${chat.id}`}
                    className={cn(
                      "block truncate rounded-lg px-2 py-2 text-sm",
                      active
                        ? "bg-[var(--surface)] font-medium text-[var(--foreground)]"
                        : "text-[var(--foreground)]/80 hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
                    )}
                  >
                    {chat.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        {deleteError ? (
          <p className="px-2 pt-2 text-[11px] text-red-600" role="alert">
            {deleteError}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-3">
        <UserButton />
        <ThemeToggle />
      </div>

      <AddSourceDialog
        open={addOpen}
        notebookId={notebook.id}
        onClose={() => setAddOpen(false)}
        onUploaded={() => router.refresh()}
      />

      <SourceMetadataDialog
        source={metadataSource}
        onClose={() => setMetadataSource(null)}
      />

      <DeleteNotebookDialog
        open={Boolean(deleteNotebook)}
        notebookId={deleteNotebook?.id ?? ""}
        notebookTitle={deleteNotebook?.title ?? ""}
        isOnlyNotebook={notebooks.length <= 1}
        onClose={() => setDeleteNotebook(null)}
        onDeleted={(deletedId) => {
          setDeleteNotebook(null);
          onNotebookDeleted(deletedId);
        }}
      />
    </aside>
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

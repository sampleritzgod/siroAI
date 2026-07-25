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
  /** While indexing, show a quiet sidebar (no search / chats / add). */
  variant?: "default" | "indexing";
};

export function SourcesPanel({
  notebook,
  notebooks,
  sources,
  conversations,
  onSelectNotebook,
  onNotebookDeleted,
  variant = "default",
}: SourcesPanelProps) {
  const isIndexing = variant === "indexing";
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [notebookActions, setNotebookActions] =
    useState<NotebookListItem | null>(null);
  const [renameNotebook, setRenameNotebook] = useState<NotebookListItem | null>(
    null
  );
  const [notebookTitle, setNotebookTitle] = useState("");
  const [deleteNotebook, setDeleteNotebook] = useState<NotebookListItem | null>(
    null
  );
  const [addOpen, setAddOpen] = useState(false);
  const [sourceActions, setSourceActions] = useState<SourceListItem | null>(
    null
  );
  const [renameSourceItem, setRenameSourceItem] =
    useState<SourceListItem | null>(null);
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
        {!isIndexing ? (
          <button
            type="button"
            onClick={createNotebookNow}
            disabled={isPending}
            className="rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            + New
          </button>
        ) : null}
      </div>

      <div
        className={cn(
          "shrink-0 overflow-y-auto border-b border-[var(--border)] px-2 py-2",
          isIndexing ? "max-h-none" : "max-h-[40%]"
        )}
      >
        <ul className="flex flex-col gap-0.5">
          {notebooks.map((item) => {
            const active = item.id === notebook.id;
            return (
              <li key={item.id}>
                <div
                  className={cn(
                    "flex items-center rounded-lg",
                    active && "bg-[var(--surface)]"
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectNotebook(item.id)}
                    disabled={isIndexing}
                    className={cn(
                      "min-w-0 flex-1 truncate px-2 py-2.5 text-left text-sm",
                      active
                        ? "font-medium text-[var(--foreground)]"
                        : "text-[var(--foreground)]/80 hover:text-[var(--foreground)]",
                      isIndexing && "disabled:opacity-100"
                    )}
                  >
                    {item.title}
                  </button>
                  {!isIndexing ? (
                    <button
                      type="button"
                      aria-label={`Options for ${item.title}`}
                      onClick={() => setNotebookActions(item)}
                      className="mr-0.5 rounded-lg px-2 py-2 text-[var(--muted)] hover:bg-[var(--border)]/40"
                    >
                      ···
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>

        {createError ? (
          <p className="px-2 pt-2 text-[11px] text-red-600" role="alert">
            {createError}
          </p>
        ) : null}

        {!isIndexing && deletedNotebooks.length > 0 ? (
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

      {isIndexing ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Indexing
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {sources.map((source) => (
              <li
                key={source.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-3"
              >
                <div className="flex items-start gap-2">
                  {source.indexingStatus === "PROCESSING" ||
                  source.indexingStatus === "PENDING" ? (
                    <span
                      className="mt-0.5 size-3.5 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
                      aria-hidden="true"
                    />
                  ) : (
                    <span className="mt-0.5 text-xs" aria-hidden="true">
                      {source.type === "PDF" ? "📄" : "📝"}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {source.title}
                    </p>
                    <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                      {formatIndexingStatus(source.indexingStatus)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-[var(--muted)]">
            Hang tight — chat unlocks when indexing finishes.
          </p>
        </div>
      ) : (
        <>
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
                  ? "No sources yet — only this notebook"
                  : "No sources match your search"}
              </div>
            ) : (
              <ul className="mb-4 flex flex-col gap-0.5">
                {filteredSources.map((source) => (
                  <li key={source.id}>
                    <div className="flex items-start rounded-lg px-1 py-1.5 hover:bg-[var(--surface)]">
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
                        aria-label={`Options for ${source.title}`}
                        onClick={() => setSourceActions(source)}
                        className="mr-0.5 rounded-lg px-2 py-2 text-[var(--muted)] hover:bg-[var(--border)]/40"
                      >
                        ···
                      </button>
                    </div>
                  </li>
                ))}
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
        </>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-3">
        <UserButton />
        <ThemeToggle />
      </div>

      <ActionSheet
        open={Boolean(notebookActions)}
        title={notebookActions?.title ?? "Notebook"}
        onClose={() => setNotebookActions(null)}
        actions={[
          {
            label: "Rename",
            onClick: () => {
              if (!notebookActions) return;
              setNotebookTitle(notebookActions.title);
              setRenameNotebook(notebookActions);
              setNotebookActions(null);
            },
          },
          {
            label: "Delete",
            danger: true,
            onClick: () => {
              if (!notebookActions) return;
              setDeleteNotebook(notebookActions);
              setNotebookActions(null);
            },
          },
        ]}
      />

      <ActionSheet
        open={Boolean(sourceActions)}
        title={sourceActions?.title ?? "Source"}
        onClose={() => setSourceActions(null)}
        actions={[
          {
            label: "Rename",
            onClick: () => {
              if (!sourceActions) return;
              setRenameValue(sourceActions.title);
              setRenameSourceItem(sourceActions);
              setSourceActions(null);
            },
          },
          {
            label: "Delete",
            danger: true,
            onClick: () => {
              if (!sourceActions) return;
              const target = sourceActions;
              setSourceActions(null);
              if (
                !window.confirm(
                  `Delete “${target.title}”? The file will be removed from this notebook only.`
                )
              ) {
                return;
              }
              setDeleteError(null);
              run(async () => {
                try {
                  await deleteSource(target.id);
                } catch (error) {
                  setDeleteError(
                    error instanceof Error
                      ? error.message
                      : "Could not delete source"
                  );
                }
              });
            },
          },
        ]}
      />

      <RenameDialog
        open={Boolean(renameNotebook)}
        label="Rename notebook"
        value={notebookTitle}
        maxLength={100}
        onChange={setNotebookTitle}
        onClose={() => setRenameNotebook(null)}
        onSave={() => {
          if (!renameNotebook) return;
          run(async () => {
            await updateNotebook({
              id: renameNotebook.id,
              title: notebookTitle,
            });
            setRenameNotebook(null);
          });
        }}
      />

      <RenameDialog
        open={Boolean(renameSourceItem)}
        label="Rename source"
        value={renameValue}
        maxLength={SOURCE_TITLE_MAX_LENGTH}
        onChange={setRenameValue}
        onClose={() => setRenameSourceItem(null)}
        onSave={() => {
          if (!renameSourceItem) return;
          run(async () => {
            await renameSource({
              id: renameSourceItem.id,
              title: renameValue,
            });
            setRenameSourceItem(null);
          });
        }}
      />

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

function ActionSheet({
  open,
  title,
  actions,
  onClose,
}: {
  open: boolean;
  title: string;
  actions: Array<{ label: string; onClick: () => void; danger?: boolean }>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-[71] w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-xl"
      >
        <p className="truncate px-3 py-2 text-xs font-medium text-[var(--muted)]">
          {title}
        </p>
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={action.onClick}
            className={cn(
              "block w-full rounded-xl px-3 py-3.5 text-left text-base hover:bg-[var(--sidebar)] sm:py-3 sm:text-sm",
              action.danger && "text-red-600"
            )}
          >
            {action.label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="mt-1 block w-full rounded-xl px-3 py-3.5 text-left text-base text-[var(--muted)] hover:bg-[var(--sidebar)] sm:py-3 sm:text-sm"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function RenameDialog({
  open,
  label,
  value,
  maxLength,
  onChange,
  onClose,
  onSave,
}: {
  open: boolean;
  label: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <form
        role="dialog"
        aria-modal="true"
        className="relative z-[71] w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (!value.trim()) return;
          onSave();
        }}
      >
        <h2 className="text-base font-semibold tracking-tight">{label}</h2>
        <input
          autoFocus
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
          className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm outline-none focus:border-[var(--accent)]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--sidebar)]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

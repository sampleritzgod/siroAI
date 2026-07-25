"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { updateNotebook } from "@/modules/notebook/actions/notebook-actions";
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
  onSelectNotebook: (notebookId: string) => void;
  onRequestCreateNotebook: () => void;
  onNotebookDeleted: (notebookId: string) => void;
};

export function SourcesPanel({
  notebook,
  notebooks,
  sources,
  onSelectNotebook,
  onRequestCreateNotebook,
  onNotebookDeleted,
}: SourcesPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [notebookMenuOpen, setNotebookMenuOpen] = useState(false);
  const [renamingNotebook, setRenamingNotebook] = useState(false);
  const [notebookTitle, setNotebookTitle] = useState(notebook.title);
  const [deleteNotebookOpen, setDeleteNotebookOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [metadataSource, setMetadataSource] = useState<SourceListItem | null>(
    null
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    setNotebookTitle(notebook.title);
  }, [notebook.title]);

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

  function run(action: () => Promise<void>) {
    startTransition(() => {
      void action().then(() => router.refresh());
    });
  }

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 flex-col bg-[var(--sidebar)]",
        isPending && "opacity-90"
      )}
    >
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3">
        {renamingNotebook ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(event) => {
              event.preventDefault();
              run(async () => {
                await updateNotebook({
                  id: notebook.id,
                  title: notebookTitle,
                });
                setRenamingNotebook(false);
              });
            }}
          >
            <input
              autoFocus
              value={notebookTitle}
              maxLength={100}
              onChange={(event) => setNotebookTitle(event.target.value)}
              onBlur={() => setRenamingNotebook(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setRenamingNotebook(false);
              }}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm font-semibold outline-none"
            />
          </form>
        ) : (
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
            {notebook.title}
          </h2>
        )}

        <div className="relative">
          <button
            type="button"
            aria-label="Notebook menu"
            onClick={() => setNotebookMenuOpen((open) => !open)}
            className="rounded-lg px-2 py-1 text-[var(--muted)] hover:bg-[var(--surface)]"
          >
            ···
          </button>
          {notebookMenuOpen ? (
            <div className="absolute right-0 top-9 z-20 w-48 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
              <MenuButton
                onClick={() => {
                  setNotebookTitle(notebook.title);
                  setRenamingNotebook(true);
                  setNotebookMenuOpen(false);
                }}
              >
                Rename
              </MenuButton>
              <MenuButton
                danger
                onClick={() => {
                  setDeleteNotebookOpen(true);
                  setNotebookMenuOpen(false);
                }}
              >
                Delete
              </MenuButton>
              <div className="my-1 border-t border-[var(--border)]" />
              <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
                Notebooks
              </p>
              {notebooks.map((item) => (
                <MenuButton
                  key={item.id}
                  onClick={() => {
                    onSelectNotebook(item.id);
                    setNotebookMenuOpen(false);
                  }}
                >
                  {item.id === notebook.id ? `✓ ${item.title}` : item.title}
                </MenuButton>
              ))}
              <MenuButton
                onClick={() => {
                  onRequestCreateNotebook();
                  setNotebookMenuOpen(false);
                }}
              >
                + New Notebook
              </MenuButton>
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-b border-[var(--border)] p-3">
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
        {filteredSources.length === 0 ? (
          <div className="mx-1 rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--muted)]">
            {sources.length === 0
              ? "No sources yet"
              : "No sources match your search"}
          </div>
        ) : (
          <ul className="flex flex-col gap-0.5">
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
        open={deleteNotebookOpen}
        notebookId={notebook.id}
        notebookTitle={notebook.title}
        isOnlyNotebook={notebooks.length <= 1}
        onClose={() => setDeleteNotebookOpen(false)}
        onDeleted={(deletedId) => {
          setDeleteNotebookOpen(false);
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

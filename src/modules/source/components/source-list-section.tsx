"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "@/lib/utils";
import {
  deleteSource,
  renameSource,
} from "@/modules/source/actions/source-actions";
import { AddSourceDialog } from "@/modules/source/components/add-source-dialog";
import { SourceMetadataDialog } from "@/modules/source/components/source-metadata-dialog";
import { SOURCE_TITLE_MAX_LENGTH } from "@/modules/source/constants";
import type { SourceListItem } from "@/modules/source/service";
import { formatIndexingStatus } from "@/modules/source/status-label";

type SourceListSectionProps = {
  notebookId: string;
  sources: SourceListItem[];
};

export function SourceListSection({
  notebookId,
  sources,
}: SourceListSectionProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [metadataSource, setMetadataSource] = useState<SourceListItem | null>(
    null
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function run(action: () => Promise<void>) {
    startTransition(() => {
      void action().then(() => router.refresh());
    });
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-1",
        isPending && "opacity-80"
      )}
    >
      <p className="px-2 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        Sources
      </p>

      {sources.length === 0 ? (
        <div className="mx-1 rounded-lg border border-dashed border-[var(--border)] px-3 py-4 text-center text-sm text-[var(--muted)]">
          No sources yet
        </div>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {sources.map((source) => {
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
                    <div className="min-w-0 flex-1 px-1">
                      <p className="truncate text-sm text-[var(--foreground)]">
                        <span aria-hidden="true">📄 </span>
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
                    </div>

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
        <p className="px-2 text-[11px] text-red-600" role="alert">
          {deleteError}
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="mx-1 mt-1 rounded-lg border border-dashed border-[var(--border)] px-3 py-2 text-left text-sm font-medium text-[var(--foreground)] transition hover:bg-[var(--surface)]"
      >
        + Add Source
      </button>

      <AddSourceDialog
        open={addOpen}
        notebookId={notebookId}
        onClose={() => setAddOpen(false)}
        onUploaded={() => router.refresh()}
      />

      <SourceMetadataDialog
        source={metadataSource}
        onClose={() => setMetadataSource(null)}
      />
    </div>
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

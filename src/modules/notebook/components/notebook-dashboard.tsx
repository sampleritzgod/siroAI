"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { MobileNavButton } from "@/components/mobile-nav-button";
import { cn } from "@/lib/utils";
import {
  createConversation,
  getConversationLastMessagePreviews,
  startNewChat,
  type ConversationListItem,
} from "@/modules/conversation/actions/conversation-actions";
import { ConversationListSection } from "@/modules/conversation/components/conversation-list-section";
import { PENDING_STARTER_PROMPT_KEY } from "@/modules/conversation/pending-starter-prompt";
import {
  getNotebookIndexedChunkCount,
  updateNotebook,
} from "@/modules/notebook/actions/notebook-actions";
import { DeleteNotebookDialog } from "@/modules/notebook/components/delete-notebook-dialog";
import type { NotebookListItem } from "@/modules/notebook/service";
import { AddSourceDialog } from "@/modules/source/components/add-source-dialog";
import { SourceListSection } from "@/modules/source/components/source-list-section";
import { SourceMetadataDialog } from "@/modules/source/components/source-metadata-dialog";
import type { SourceListItem } from "@/modules/source/service";
import { formatIndexingStatus } from "@/modules/source/status-label";

const SUGGESTED_QUESTIONS = [
  "Explain Attention",
  "Summarize my documents",
  "Generate flashcards",
  "Quiz me",
] as const;

const RECENT_SOURCES_LIMIT = 5;
const RECENT_CONVERSATIONS_LIMIT = 5;

type NotebookDashboardProps = {
  notebook: NotebookListItem;
  notebooks: NotebookListItem[];
  sources: SourceListItem[];
  conversations: ConversationListItem[];
  archivedConversations: ConversationListItem[];
  onNotebookDeleted: (notebookId: string) => void;
};

export function NotebookDashboard({
  notebook,
  notebooks,
  sources,
  conversations,
  archivedConversations,
  onNotebookDeleted,
}: NotebookDashboardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(notebook.title);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [viewAllSourcesOpen, setViewAllSourcesOpen] = useState(false);
  const [viewAllChatsOpen, setViewAllChatsOpen] = useState(false);
  const [metadataSource, setMetadataSource] = useState<SourceListItem | null>(
    null
  );
  const [shareHint, setShareHint] = useState(false);
  const [starterError, setStarterError] = useState<string | null>(null);
  const [indexedChunks, setIndexedChunks] = useState<number | null>(null);
  const [messagePreviews, setMessagePreviews] = useState<
    Record<string, string>
  >({});

  const recentSources = useMemo(
    () =>
      [...sources]
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        )
        .slice(0, RECENT_SOURCES_LIMIT),
    [sources]
  );

  const recentConversations = useMemo(
    () =>
      [...conversations]
        .sort(
          (a, b) =>
            new Date(b.lastMessageAt).getTime() -
            new Date(a.lastMessageAt).getTime()
        )
        .slice(0, RECENT_CONVERSATIONS_LIMIT),
    [conversations]
  );

  useEffect(() => {
    let cancelled = false;
    void getNotebookIndexedChunkCount(notebook.id)
      .then((count) => {
        if (!cancelled) setIndexedChunks(count);
      })
      .catch(() => {
        if (!cancelled) setIndexedChunks(0);
      });
    return () => {
      cancelled = true;
    };
  }, [notebook.id, sources.length, conversations.length]);

  useEffect(() => {
    let cancelled = false;
    const ids = recentConversations.map((item) => item.id);
    if (ids.length === 0) {
      setMessagePreviews({});
      return;
    }
    void getConversationLastMessagePreviews(ids)
      .then((previews) => {
        if (!cancelled) setMessagePreviews(previews);
      })
      .catch(() => {
        if (!cancelled) setMessagePreviews({});
      });
    return () => {
      cancelled = true;
    };
  }, [recentConversations]);

  const stats = useMemo(() => {
    const storageBytes = sources.reduce(
      (total, source) => total + source.fileSize,
      0
    );
    return {
      sources: sources.length,
      conversations: conversations.length,
      indexedChunks: indexedChunks ?? "—",
      storageLabel: formatBytes(storageBytes),
    };
  }, [sources, conversations.length, indexedChunks]);

  function run(action: () => Promise<void>) {
    startTransition(() => {
      void action().then(() => router.refresh());
    });
  }

  function startSuggestedQuestion(prompt: string) {
    setStarterError(null);
    startTransition(() => {
      void (async () => {
        try {
          const conversation = await createConversation(notebook.id);
          sessionStorage.setItem(
            PENDING_STARTER_PROMPT_KEY,
            JSON.stringify({
              conversationId: conversation.id,
              text: prompt,
            })
          );
          router.push(`/c/${conversation.id}`);
          router.refresh();
        } catch (error) {
          setStarterError(
            error instanceof Error
              ? error.message
              : "Could not start chat from suggestion"
          );
        }
      })();
    });
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain",
        isPending && "opacity-90"
      )}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 md:hidden">
        <MobileNavButton />
        <span className="min-w-0 truncate text-sm font-semibold tracking-tight">
          {notebook.title}
        </span>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-6 sm:px-8 sm:py-8">
        {/* Section 1 — Notebook header */}
        <section>
          {renaming ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                run(async () => {
                  await updateNotebook({
                    id: notebook.id,
                    title: renameValue,
                  });
                  setRenaming(false);
                });
              }}
            >
              <input
                autoFocus
                value={renameValue}
                maxLength={100}
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={() => setRenaming(false)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setRenaming(false);
                }}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-2xl font-semibold outline-none"
              />
            </form>
          ) : (
            <h2 className="text-2xl font-semibold tracking-tight">
              {notebook.title}
            </h2>
          )}

          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
            {notebook.description?.trim() || "No description yet"}
          </p>

          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--muted)]">
            <div>
              <dt className="inline">Created </dt>
              <dd className="inline text-[var(--foreground)]/70">
                {formatDate(notebook.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="inline">Updated </dt>
              <dd className="inline text-[var(--foreground)]/70">
                {formatDate(notebook.updatedAt)}
              </dd>
            </div>
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <ActionButton
              onClick={() => {
                setRenameValue(notebook.title);
                setRenaming(true);
              }}
            >
              Rename
            </ActionButton>
            <ActionButton onClick={() => setDeleteOpen(true)} danger>
              Delete
            </ActionButton>
            <ActionButton
              onClick={() => {
                setShareHint(true);
                window.setTimeout(() => setShareHint(false), 2000);
              }}
            >
              Share
            </ActionButton>
          </div>
          {shareHint ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Sharing is coming soon.
            </p>
          ) : null}
        </section>

        {/* Section 2 — Sources */}
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold tracking-tight">Sources</h3>
            {sources.length > 0 ? (
              <button
                type="button"
                onClick={() => setViewAllSourcesOpen(true)}
                className="text-xs font-medium text-[var(--accent)] hover:underline"
              >
                View All
              </button>
            ) : null}
          </div>

          {sources.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--border)] px-5 py-8 text-center">
              <p className="text-sm text-[var(--foreground)]/80">
                This notebook doesn&apos;t have any sources yet.
              </p>
              <div className="mt-5 flex flex-col items-center justify-center gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setAddSourceOpen(true)}
                  className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
                >
                  Add Source
                </button>
                <form action={startNewChat}>
                  <input type="hidden" name="notebookId" value={notebook.id} />
                  <button
                    type="submit"
                    disabled={isPending}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium transition hover:bg-[var(--background)] disabled:opacity-50"
                  >
                    Start Empty Chat
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <>
              <ul className="mt-4 flex flex-col gap-1">
                {recentSources.map((source) => (
                  <li key={source.id}>
                    <button
                      type="button"
                      onClick={() => setMetadataSource(source)}
                      className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-[var(--surface)]"
                    >
                      <span
                        className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm"
                        aria-hidden="true"
                      >
                        {source.type === "PDF" ? "📄" : "📝"}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {source.title}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-[var(--muted)]">
                          <span>{source.type}</span>
                          <span
                            className={cn(
                              source.indexingStatus === "FAILED" &&
                                "text-red-600",
                              source.indexingStatus === "PROCESSING" &&
                                "text-[var(--accent)]"
                            )}
                          >
                            {formatIndexingStatus(source.indexingStatus)}
                          </span>
                          <span>{formatDate(source.createdAt)}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setAddSourceOpen(true)}
                className="mt-3 text-sm font-medium text-[var(--accent)] hover:underline"
              >
                + Add Source
              </button>
            </>
          )}
        </section>

        {/* Section 3 — Recent conversations */}
        <section>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold tracking-tight">
              Recent Conversations
            </h3>
            {conversations.length > 0 ? (
              <button
                type="button"
                onClick={() => setViewAllChatsOpen(true)}
                className="text-xs font-medium text-[var(--accent)] hover:underline"
              >
                View All
              </button>
            ) : null}
          </div>

          {recentConversations.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">
              No conversations in this notebook yet.
            </p>
          ) : (
            <ul className="mt-4 flex flex-col gap-1">
              {recentConversations.map((conversation) => {
                const active = pathname === `/c/${conversation.id}`;
                return (
                  <li key={conversation.id}>
                    <Link
                      href={`/c/${conversation.id}`}
                      className={cn(
                        "block rounded-lg px-2 py-2.5 transition hover:bg-[var(--surface)]",
                        active && "bg-[var(--surface)]"
                      )}
                    >
                      <p className="truncate text-sm font-medium">
                        {conversation.title}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-[var(--muted)]">
                        {messagePreviews[conversation.id] ||
                          conversationPreview(conversation)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                        {formatRelativeTime(conversation.lastMessageAt)}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}

          {sources.length > 0 ? (
            <form action={startNewChat} className="mt-4">
              <input type="hidden" name="notebookId" value={notebook.id} />
              <button
                type="submit"
                disabled={isPending}
                className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              >
                New Chat
              </button>
            </form>
          ) : null}
        </section>

        {/* Section 4 — Statistics */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Sources" value={String(stats.sources)} />
          <StatCard label="Conversations" value={String(stats.conversations)} />
          <StatCard
            label="Indexed Chunks"
            value={String(stats.indexedChunks)}
          />
          <StatCard label="Storage Used" value={stats.storageLabel} />
        </section>

        {/* Section 5 — Suggested questions */}
        {sources.length > 0 ? (
          <section>
            <h3 className="text-sm font-semibold tracking-tight">
              Suggested Questions
            </h3>
            <div className="mt-4 flex flex-col gap-2">
              {SUGGESTED_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  disabled={isPending}
                  onClick={() => startSuggestedQuestion(question)}
                  className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left text-sm transition hover:bg-[var(--background)] disabled:opacity-50"
                >
                  {question}
                </button>
              ))}
            </div>
            {starterError ? (
              <p className="mt-2 text-xs text-red-600" role="alert">
                {starterError}
              </p>
            ) : null}
          </section>
        ) : null}
      </div>

      <DeleteNotebookDialog
        open={deleteOpen}
        notebookId={notebook.id}
        notebookTitle={notebook.title}
        isOnlyNotebook={notebooks.length <= 1}
        onClose={() => setDeleteOpen(false)}
        onDeleted={(deletedId) => {
          setDeleteOpen(false);
          onNotebookDeleted(deletedId);
        }}
      />

      <AddSourceDialog
        open={addSourceOpen}
        notebookId={notebook.id}
        onClose={() => setAddSourceOpen(false)}
        onUploaded={() => router.refresh()}
      />

      <SourceMetadataDialog
        source={metadataSource}
        onClose={() => setMetadataSource(null)}
      />

      {viewAllSourcesOpen ? (
        <PanelDialog
          title="All sources"
          onClose={() => setViewAllSourcesOpen(false)}
        >
          <SourceListSection notebookId={notebook.id} sources={sources} />
        </PanelDialog>
      ) : null}

      {viewAllChatsOpen ? (
        <PanelDialog
          title="All conversations"
          onClose={() => setViewAllChatsOpen(false)}
        >
          <ConversationListSection
            conversations={conversations}
            archivedConversations={archivedConversations}
            onNavigate={() => setViewAllChatsOpen(false)}
          />
        </PanelDialog>
      ) : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)]/80 px-3 py-3">
      <p className="text-[11px] text-[var(--muted)]">{label}</p>
      <p className="mt-1 truncate text-base font-semibold tracking-tight">
        {value}
      </p>
    </div>
  );
}

function ActionButton({
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
        "rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm transition hover:bg-[var(--background)]",
        danger && "text-red-600 hover:bg-red-500/5"
      )}
    >
      {children}
    </button>
  );
}

function PanelDialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-[61] flex max-h-[85dvh] w-full max-w-lg flex-col rounded-t-xl border border-[var(--border)] bg-[var(--surface)] shadow-xl sm:rounded-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-[var(--muted)] hover:bg-[var(--background)]"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {children}
        </div>
      </div>
    </div>
  );
}

function conversationPreview(conversation: ConversationListItem): string {
  if (conversation.title === "New Chat") {
    return "No messages yet";
  }
  return "Continue this conversation";
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatRelativeTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const diffMs = date.getTime() - Date.now();
  const minutes = Math.round(diffMs / 60_000);
  const hours = Math.round(diffMs / 3_600_000);
  const days = Math.round(diffMs / 86_400_000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  if (Math.abs(hours) < 48) return formatter.format(hours, "hour");
  return formatter.format(days, "day");
}

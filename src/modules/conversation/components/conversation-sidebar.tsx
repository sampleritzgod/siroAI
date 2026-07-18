"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { UserButton } from "@clerk/nextjs";
import { useSidebar } from "@/components/sidebar-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import {
  deleteConversation,
  startNewChat,
  updateConversation,
  type ConversationListItem,
} from "@/modules/conversation/actions/conversation-actions";

type ConversationSidebarProps = {
  conversations: ConversationListItem[];
  archivedConversations?: ConversationListItem[];
};

export function ConversationSidebar({
  conversations,
  archivedConversations = [],
}: ConversationSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { open, setOpen, close } = useSidebar();
  const [isPending, startTransition] = useTransition();
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  const pinned = conversations.filter((item) => item.isPinned);
  const recent = conversations.filter((item) => !item.isPinned);

  function run(action: () => Promise<void>) {
    startTransition(() => {
      void action().then(() => router.refresh());
    });
  }

  return (
    <>
      {/* Mobile backdrop */}
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
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0"
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

        <div className="flex flex-col gap-2 px-3 pb-3">
          <form action={startNewChat}>
            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-xl bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            >
              New chat
            </button>
          </form>
          <Link
            href="/consensus"
            onClick={close}
            className={cn(
              "w-full rounded-xl border px-3 py-2.5 text-center text-sm font-medium transition",
              pathname === "/consensus"
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface)]"
            )}
          >
            Consensus
          </Link>
          <Link
            href="/usage"
            onClick={close}
            className={cn(
              "w-full rounded-xl border px-3 py-2.5 text-center text-sm font-medium transition",
              pathname === "/usage"
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--foreground)] hover:bg-[var(--surface)]"
            )}
          >
            Usage
          </Link>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-2 pb-4">
          {conversations.length === 0 ? (
            <div className="mx-1 rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-sm text-[var(--muted)]">
              No conversations yet
            </div>
          ) : (
            <>
              {pinned.length > 0 ? (
                <ConversationGroup
                  label="Pinned"
                  items={pinned}
                  pathname={pathname}
                  menuOpenId={menuOpenId}
                  renamingId={renamingId}
                  renameValue={renameValue}
                  onNavigate={close}
                  onMenuOpen={setMenuOpenId}
                  onRenameStart={(id, title) => {
                    setRenamingId(id);
                    setRenameValue(title);
                    setMenuOpenId(null);
                  }}
                  onRenameChange={setRenameValue}
                  onRenameCancel={() => setRenamingId(null)}
                  onRenameSubmit={(id) => {
                    run(async () => {
                      await updateConversation({ id, title: renameValue });
                      setRenamingId(null);
                    });
                  }}
                  onPin={(id, isPinned) => {
                    run(async () => {
                      await updateConversation({ id, isPinned });
                      setMenuOpenId(null);
                    });
                  }}
                  onArchive={(id) => {
                    run(async () => {
                      await updateConversation({ id, isArchived: true });
                      setMenuOpenId(null);
                      if (pathname === `/c/${id}`) {
                        router.push("/");
                      }
                    });
                  }}
                  onDelete={(id) => {
                    run(async () => {
                      await deleteConversation(id);
                      setMenuOpenId(null);
                      if (pathname === `/c/${id}`) {
                        router.push("/");
                      }
                    });
                  }}
                />
              ) : null}

              <ConversationGroup
                label="Recent"
                items={recent}
                pathname={pathname}
                menuOpenId={menuOpenId}
                renamingId={renamingId}
                renameValue={renameValue}
                onNavigate={close}
                onMenuOpen={setMenuOpenId}
                onRenameStart={(id, title) => {
                  setRenamingId(id);
                  setRenameValue(title);
                  setMenuOpenId(null);
                }}
                onRenameChange={setRenameValue}
                onRenameCancel={() => setRenamingId(null)}
                onRenameSubmit={(id) => {
                  run(async () => {
                    await updateConversation({ id, title: renameValue });
                    setRenamingId(null);
                  });
                }}
                onPin={(id, isPinned) => {
                  run(async () => {
                    await updateConversation({ id, isPinned });
                    setMenuOpenId(null);
                  });
                }}
                onArchive={(id) => {
                  run(async () => {
                    await updateConversation({ id, isArchived: true });
                    setMenuOpenId(null);
                    if (pathname === `/c/${id}`) {
                      router.push("/");
                    }
                  });
                }}
                onDelete={(id) => {
                  run(async () => {
                    await deleteConversation(id);
                    setMenuOpenId(null);
                    if (pathname === `/c/${id}`) {
                      router.push("/");
                    }
                  });
                }}
              />
            </>
          )}

          {archivedConversations.length > 0 ? (
            <div className="flex flex-col gap-1 px-1">
              <button
                type="button"
                onClick={() => setShowArchived((value) => !value)}
                className="px-2 py-1 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--muted)] hover:text-[var(--foreground)]"
              >
                Archived ({archivedConversations.length}){" "}
                {showArchived ? "▾" : "▸"}
              </button>
              {showArchived ? (
                <ul className="flex flex-col gap-0.5">
                  {archivedConversations.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-[var(--muted)]"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {item.title}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-[11px] text-[var(--accent)] hover:underline"
                        onClick={() => {
                          run(async () => {
                            await updateConversation({
                              id: item.id,
                              isArchived: false,
                            });
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
        </nav>

        <div className="flex items-center justify-between border-t border-[var(--border)] px-3 py-2">
          <ThemeToggle />
          <span className="text-[11px] text-[var(--muted)]">SiroAI</span>
        </div>
      </aside>
    </>
  );
}

type GroupProps = {
  label: string;
  items: ConversationListItem[];
  pathname: string;
  menuOpenId: string | null;
  renamingId: string | null;
  renameValue: string;
  onNavigate: () => void;
  onMenuOpen: (id: string | null) => void;
  onRenameStart: (id: string, title: string) => void;
  onRenameChange: (value: string) => void;
  onRenameCancel: () => void;
  onRenameSubmit: (id: string) => void;
  onPin: (id: string, isPinned: boolean) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
};

function ConversationGroup({
  label,
  items,
  pathname,
  menuOpenId,
  renamingId,
  renameValue,
  onNavigate,
  onMenuOpen,
  onRenameStart,
  onRenameChange,
  onRenameCancel,
  onRenameSubmit,
  onPin,
  onArchive,
  onDelete,
}: GroupProps) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1">
      <p className="px-2 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </p>

      {items.map((conversation) => {
        const active = pathname === `/c/${conversation.id}`;
        const renaming = renamingId === conversation.id;

        return (
          <div key={conversation.id} className="relative">
            {renaming ? (
              <form
                className="px-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  onRenameSubmit(conversation.id);
                }}
              >
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(event) => onRenameChange(event.target.value)}
                  onBlur={onRenameCancel}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") onRenameCancel();
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
                <Link
                  href={`/c/${conversation.id}`}
                  onClick={onNavigate}
                  className={cn(
                    "min-w-0 flex-1 truncate px-2 py-2.5 text-sm sm:py-2",
                    active
                      ? "font-medium text-[var(--foreground)]"
                      : "text-[var(--foreground)]/80 hover:text-[var(--foreground)]"
                  )}
                >
                  {conversation.title}
                </Link>

                <button
                  type="button"
                  aria-label="Conversation menu"
                  onClick={() =>
                    onMenuOpen(
                      menuOpenId === conversation.id ? null : conversation.id
                    )
                  }
                  className="mr-1 rounded px-1.5 py-1 text-[var(--muted)] opacity-100 transition hover:bg-[var(--border)]/40 md:opacity-0 md:group-hover:opacity-100"
                >
                  ···
                </button>
              </div>
            )}

            {menuOpenId === conversation.id ? (
              <div className="absolute right-1 top-9 z-20 w-36 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
                <MenuButton
                  onClick={() =>
                    onRenameStart(conversation.id, conversation.title)
                  }
                >
                  Rename
                </MenuButton>
                <MenuButton
                  onClick={() => onPin(conversation.id, !conversation.isPinned)}
                >
                  {conversation.isPinned ? "Unpin" : "Pin"}
                </MenuButton>
                <MenuButton onClick={() => onArchive(conversation.id)}>
                  Archive
                </MenuButton>
                <MenuButton
                  danger
                  onClick={() => onDelete(conversation.id)}
                >
                  Delete
                </MenuButton>
              </div>
            ) : null}
          </div>
        );
      })}
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

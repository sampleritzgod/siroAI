"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  deleteBranch,
  renameBranch,
  setActiveBranch,
  type BranchListItem,
} from "@/modules/conversation/actions/branch-actions";

type BranchSwitcherProps = {
  conversationId: string;
  activeBranchId: string;
  branches: BranchListItem[];
};

function getDepth(
  branch: BranchListItem,
  byId: Map<string, BranchListItem>
) {
  let depth = 0;
  let current = branch.parentBranchId;
  while (current) {
    depth += 1;
    current = byId.get(current)?.parentBranchId ?? null;
    if (depth > 8) break;
  }
  return depth;
}

export function BranchSwitcher({
  conversationId,
  activeBranchId,
  branches,
}: BranchSwitcherProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");

  const active = branches.find((branch) => branch.id === activeBranchId);
  const byId = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch])),
    [branches]
  );

  const sorted = useMemo(
    () =>
      [...branches]
        .map((branch) => ({ branch, depth: getDepth(branch, byId) }))
        .sort((a, b) => {
          if (a.depth !== b.depth) return a.depth - b.depth;
          return (
            new Date(a.branch.createdAt).getTime() -
            new Date(b.branch.createdAt).getTime()
          );
        }),
    [branches, byId]
  );

  function goToBranch(branchId: string) {
    startTransition(() => {
      void setActiveBranch(conversationId, branchId).then(() => {
        router.push(`/c/${conversationId}?branch=${branchId}`);
        router.refresh();
        setOpen(false);
      });
    });
  }

  return (
    <div className="relative flex min-w-0 shrink-0 items-center gap-0.5 sm:gap-1">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setMenuOpen(false);
          setOpen((value) => !value);
        }}
        className="flex max-w-[7.5rem] items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-medium sm:max-w-[14rem] sm:gap-1.5 sm:px-2.5"
      >
        <span aria-hidden className="text-[var(--muted)]">
          ⎇
        </span>
        <span className="truncate">{active?.title ?? "Main"}</span>
        <span className="rounded-full bg-[var(--sidebar)] px-1.5 text-[10px] text-[var(--muted)]">
          {Math.max(branches.length, 1)}
        </span>
      </button>

      {active ? (
        <button
          type="button"
          aria-label="Branch actions"
          onClick={() => setMenuOpen((value) => !value)}
          className="rounded-full px-2 py-1 text-xs text-[var(--muted)] hover:bg-[var(--surface)]"
        >
          ···
        </button>
      ) : null}

      {open ? (
        <div className="absolute right-0 top-9 z-30 w-[min(16rem,calc(100vw-1.5rem))] rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg sm:w-64">
          <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--muted)]">
            Branches
          </p>
          {sorted.map(({ branch, depth }) => (
            <button
              key={branch.id}
              type="button"
              onClick={() => {
                if (branch.id !== activeBranchId) {
                  goToBranch(branch.id);
                } else {
                  setOpen(false);
                }
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--sidebar)]",
                branch.id === activeBranchId && "bg-[var(--sidebar)] font-medium"
              )}
              style={{ paddingLeft: `${12 + depth * 12}px` }}
            >
              <span className="truncate">{branch.title}</span>
              {branch.isMain ? (
                <span className="ml-auto text-[10px] text-[var(--muted)]">
                  Main
                </span>
              ) : null}
            </button>
          ))}
          {sorted.length <= 1 ? (
            <p className="px-3 py-2 text-xs text-[var(--muted)]">
              Use “Branch from here” on a message to explore an alternate path.
            </p>
          ) : null}
        </div>
      ) : null}

      {menuOpen && active ? (
        <div className="absolute right-0 top-9 z-30 w-40 rounded-xl border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
          {renaming ? (
            <form
              className="px-2 py-1"
              onSubmit={(event) => {
                event.preventDefault();
                startTransition(() => {
                  void renameBranch(active.id, renameValue).then(() => {
                    setRenaming(false);
                    setMenuOpen(false);
                    router.refresh();
                  });
                });
              }}
            >
              <input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setRenaming(false);
                  }
                }}
                className="w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-sm outline-none"
              />
            </form>
          ) : (
            <>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-[var(--sidebar)]"
                onClick={() => {
                  setRenameValue(active.title);
                  setRenaming(true);
                }}
              >
                Rename
              </button>
              {!active.isMain ? (
                <button
                  type="button"
                  className="block w-full px-3 py-1.5 text-left text-sm text-red-600 hover:bg-[var(--sidebar)]"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Delete “${active.title}”? Shared history on parent branches stays intact.`
                      )
                    ) {
                      return;
                    }
                    startTransition(() => {
                      void deleteBranch(active.id).then((result) => {
                        setMenuOpen(false);
                        router.push(
                          `/c/${conversationId}?branch=${result.activeBranchId}`
                        );
                        router.refresh();
                      });
                    });
                  }}
                >
                  Delete branch
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

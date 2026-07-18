"use client";

import { useState, useTransition } from "react";
import {
  disableShare,
  enableShare,
  rotateShare,
  type ShareState,
} from "@/modules/conversation/actions/share-actions";

type ShareControlsProps = {
  conversationId: string;
  initialShare: ShareState;
};

export function ShareControls({
  conversationId,
  initialShare,
}: ShareControlsProps) {
  const [share, setShare] = useState(initialShare);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const absoluteUrl =
    typeof window !== "undefined" && share.sharePath
      ? `${window.location.origin}${share.sharePath}`
      : share.sharePath;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] hover:border-[var(--accent)] hover:text-[var(--foreground)]"
      >
        {share.shareToken ? "Sharing" : "Share"}
      </button>

      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg">
          <p className="text-xs font-medium text-[var(--foreground)]">
            Read-only link
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[var(--muted)]">
            Anyone with the link can view this branch. They cannot chat or edit.
          </p>

          {share.sharePath ? (
            <div className="mt-3 space-y-2">
              <code className="block truncate rounded-lg bg-[var(--background)] px-2 py-1.5 text-[11px]">
                {absoluteUrl}
              </code>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={pending || !absoluteUrl}
                  onClick={() => {
                    if (!absoluteUrl) return;
                    void navigator.clipboard.writeText(absoluteUrl).then(() => {
                      setCopied(true);
                      window.setTimeout(() => setCopied(false), 1200);
                    });
                  }}
                  className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                >
                  {copied ? "Copied" : "Copy link"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    startTransition(() => {
                      void rotateShare(conversationId).then(setShare);
                    });
                  }}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
                >
                  Rotate
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => {
                    startTransition(() => {
                      void disableShare(conversationId).then(setShare);
                    });
                  }}
                  className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--foreground)] disabled:opacity-40"
                >
                  Disable
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                startTransition(() => {
                  void enableShare(conversationId).then(setShare);
                });
              }}
              className="mt-3 w-full rounded-lg bg-[var(--accent)] px-2.5 py-1.5 text-[11px] font-medium text-white disabled:opacity-40"
            >
              Create link
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

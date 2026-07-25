"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { createConversation } from "@/modules/conversation/actions/conversation-actions";
import { PENDING_STARTER_PROMPT_KEY } from "@/modules/conversation/pending-starter-prompt";
import type { NotebookListItem } from "@/modules/notebook/service";

const SUGGESTED_PROMPTS = [
  "Explain the key ideas in my sources",
  "Summarize my documents",
  "Generate flashcards from this notebook",
  "Quiz me on the material",
] as const;

type NotebookChatWelcomeProps = {
  notebook: NotebookListItem;
};

export function NotebookChatWelcome({ notebook }: NotebookChatWelcomeProps) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startChat(prompt: string) {
    const text = prompt.trim();
    if (!text || isPending) return;

    setError(null);
    startTransition(() => {
      void (async () => {
        try {
          const conversation = await createConversation(notebook.id);
          sessionStorage.setItem(
            PENDING_STARTER_PROMPT_KEY,
            JSON.stringify({
              conversationId: conversation.id,
              text,
            })
          );
          router.push(`/c/${conversation.id}`);
          router.refresh();
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Could not start chat"
          );
        }
      })();
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-[var(--background)]">
      <header className="flex h-14 shrink-0 items-center border-b border-[var(--border)] px-4">
        <h1 className="min-w-0 truncate text-sm font-semibold tracking-tight">
          {notebook.title}
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-6 px-4 py-8 text-center">
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
              {notebook.title}
            </h2>
            <p className="text-sm text-[var(--muted)]">
              {notebook.description?.trim() ||
                "Add sources, then ask anything about this notebook."}
            </p>
          </div>

          <div className="flex w-full flex-col gap-2">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled={isPending}
                onClick={() => startChat(prompt)}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-left text-sm transition hover:bg-[var(--sidebar)] disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t border-[var(--border)] p-3 sm:p-4">
        <form
          className="mx-auto flex w-full max-w-2xl flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            startChat(value);
          }}
        >
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            rows={2}
            placeholder="Ask a question about your sources…"
            disabled={isPending}
            className="w-full resize-none rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-sm outline-none placeholder:text-[var(--muted)] disabled:opacity-50"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                startChat(value);
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            {error ? (
              <p className="text-xs text-red-600" role="alert">
                {error}
              </p>
            ) : (
              <span className="text-xs text-[var(--muted)]">
                Enter to send
              </span>
            )}
            <button
              type="submit"
              disabled={isPending || !value.trim()}
              className={cn(
                "rounded-xl bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
              )}
            >
              {isPending ? "Starting…" : "Ask"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

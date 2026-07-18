"use client";

import {
  isFileUIPart,
  isTextUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { RagSearchToolCard } from "@/modules/conversation/components/rag-search-tool-card";
import { ThinkingIndicator } from "@/modules/conversation/components/thinking-indicator";
import { WebSearchToolCard } from "@/modules/conversation/components/web-search-tool-card";

type ChatMessagesProps = {
  messages: UIMessage[];
  isThinking: boolean;
  busy?: boolean;
  onBranchFromMessage?: (messageId: string) => void;
  onRegenerate?: (messageId: string) => void;
  onEditUserMessage?: (messageId: string, text: string) => void;
};

function getText(message: UIMessage) {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("");
}

async function copyText(text: string) {
  if (!text.trim()) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore clipboard failures (permissions / insecure context)
  }
}

export function ChatMessages({
  messages,
  isThinking,
  busy,
  onBranchFromMessage,
  onRegenerate,
  onEditUserMessage,
}: ChatMessagesProps) {
  const settlePending = !busy && !isThinking;
  const lastAssistantId = [...messages]
    .reverse()
    .find((message) => message.role === "assistant")?.id;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-3 py-4 sm:gap-4 sm:px-4 sm:py-6">
      {messages.map((message) => {
        const text = getText(message);
        const toolParts = message.parts.filter(isToolUIPart);
        const fileParts = message.parts.filter(isFileUIPart);
        const isUser = message.role === "user";
        const isEditing = editingId === message.id;
        const canShowBubble =
          text ||
          (message.role === "assistant" &&
            toolParts.length === 0 &&
            fileParts.length === 0);

        if (
          !text &&
          toolParts.length === 0 &&
          fileParts.length === 0 &&
          message.role !== "assistant"
        ) {
          return null;
        }

        return (
          <div
            key={message.id}
            className={cn(
              "group flex flex-col gap-1",
              isUser ? "items-end" : "items-start"
            )}
          >
            {toolParts.map((part) => {
              if (part.type === "tool-webSearch") {
                return (
                  <WebSearchToolCard
                    key={part.toolCallId}
                    part={part}
                    settlePending={settlePending}
                  />
                );
              }
              if (part.type === "tool-ragSearch") {
                return (
                  <RagSearchToolCard
                    key={part.toolCallId}
                    part={part}
                    settlePending={settlePending}
                  />
                );
              }
              return null;
            })}

            {fileParts.length > 0 ? (
              <div
                className={cn(
                  "flex max-w-[92%] flex-wrap gap-2 sm:max-w-[85%]",
                  isUser ? "justify-end" : "justify-start"
                )}
              >
                {fileParts.map((part, index) => {
                  const key = `${message.id}-file-${index}`;
                  if (part.mediaType.startsWith("image/") && part.url) {
                    return (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={key}
                        src={part.url}
                        alt={part.filename ?? "Attached image"}
                        className="max-h-56 max-w-full rounded-xl object-contain ring-1 ring-[var(--border)]"
                      />
                    );
                  }

                  return (
                    <a
                      key={key}
                      href={part.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-xs text-[var(--foreground)] hover:border-[var(--accent)]"
                    >
                      {part.filename ?? "Attachment"}
                    </a>
                  );
                })}
              </div>
            ) : null}

            {isEditing ? (
              <div className="flex w-full max-w-[92%] flex-col gap-2 sm:max-w-[85%]">
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  rows={4}
                  className="w-full resize-y rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[15px] leading-relaxed text-[var(--foreground)] outline-none ring-[var(--accent)] focus:ring-2"
                  disabled={busy}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(null);
                      setDraft("");
                    }}
                    className="rounded-lg px-2.5 py-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy || !draft.trim()}
                    onClick={() => {
                      const next = draft.trim();
                      if (!next || !onEditUserMessage) return;
                      onEditUserMessage(message.id, next);
                      setEditingId(null);
                      setDraft("");
                    }}
                    className="rounded-lg bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
                  >
                    Save & branch
                  </button>
                </div>
              </div>
            ) : canShowBubble ? (
              <div
                className={cn(
                  "max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed sm:max-w-[85%] sm:px-4 sm:py-3",
                  isUser
                    ? "bg-[var(--accent)] text-white"
                    : "bg-[var(--surface)] text-[var(--foreground)] ring-1 ring-[var(--border)]"
                )}
              >
                {text || (isThinking ? "" : "…")}
              </div>
            ) : null}

            {!isEditing &&
            (text || toolParts.length > 0 || fileParts.length > 0) ? (
              <div
                className={cn(
                  "flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)] opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100",
                  isUser ? "mr-1 justify-end" : "ml-1 justify-start"
                )}
              >
                {text ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void copyText(text).then(() => {
                        setCopiedId(message.id);
                        window.setTimeout(() => setCopiedId(null), 1200);
                      });
                    }}
                    className="hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    {copiedId === message.id ? "Copied" : "Copy"}
                  </button>
                ) : null}

                {isUser && onEditUserMessage && text ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setEditingId(message.id);
                      setDraft(text);
                    }}
                    className="hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    Edit
                  </button>
                ) : null}

                {!isUser &&
                onRegenerate &&
                message.id === lastAssistantId ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onRegenerate(message.id)}
                    className="hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    Regenerate
                  </button>
                ) : null}

                {onBranchFromMessage ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onBranchFromMessage(message.id)}
                    className="hover:text-[var(--foreground)] disabled:opacity-40"
                  >
                    Branch from here
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}

      {isThinking ? <ThinkingIndicator /> : null}
    </div>
  );
}

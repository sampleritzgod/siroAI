"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ModelDefinition } from "@/modules/ai/model-registry";
import {
  createBranchForEdit,
  createBranchFromMessage,
  type BranchListItem,
} from "@/modules/conversation/actions/branch-actions";
import {
  startNewChat,
  updateConversation,
} from "@/modules/conversation/actions/conversation-actions";
import type { ShareState } from "@/modules/conversation/actions/share-actions";
import { BranchSwitcher } from "@/modules/conversation/components/branch-switcher";
import { ChatComposer } from "@/modules/conversation/components/chat-composer";
import { ChatMessages } from "@/modules/conversation/components/chat-messages";
import { ShareControls } from "@/modules/conversation/components/share-controls";
import {
  clearPendingStarterPrompt,
  readPendingStarterPrompt,
} from "@/modules/conversation/pending-starter-prompt";

const PENDING_EDIT_KEY = "siro:pending-edit";

type PendingEdit = {
  conversationId: string;
  branchId: string;
  text: string;
};

type ConversationViewProps = {
  conversationId: string;
  notebookId: string;
  branchId: string;
  title: string;
  initialMessages: UIMessage[];
  branches: BranchListItem[];
  models: ModelDefinition[];
  modelId: string;
  webSearchConfigured: boolean;
  initialShare: ShareState;
};

function isChatBusy(status: string) {
  return status === "submitted" || status === "streaming";
}

function readPendingEdit(): PendingEdit | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PENDING_EDIT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingEdit;
  } catch {
    return null;
  }
}

export function ConversationView({
  conversationId,
  notebookId,
  branchId,
  title,
  initialMessages,
  branches,
  models: modelsProp,
  modelId: initialModelId,
  webSearchConfigured,
  initialShare,
}: ConversationViewProps) {
  const router = useRouter();
  const [isBranching, startBranchTransition] = useTransition();
  const [modelId, setModelId] = useState(initialModelId);
  const [forceWebSearch, setForceWebSearch] = useState(false);
  const pendingEditSent = useRef(false);
  const pendingStarterSent = useRef(false);

  // Guard against Fast Refresh / partial prop hydration (models can briefly be undefined).
  const models = modelsProp ?? [];
  const selectedModel =
    models.find((model) => model.id === modelId) ?? models[0];
  const toolsSupported = selectedModel?.capabilities.tools ?? false;
  const visionEnabled = selectedModel?.capabilities.vision ?? false;
  const webSearchEnabled = toolsSupported && webSearchConfigured;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({
          messages,
          body,
          trigger,
          messageId,
        }) => ({
          body: {
            id: conversationId,
            branchId,
            message: messages.at(-1),
            trigger,
            messageId,
            forceWebSearch: Boolean(
              body &&
                typeof body === "object" &&
                "forceWebSearch" in body &&
                (body as { forceWebSearch?: unknown }).forceWebSearch
            ),
          },
        }),
        fetch: async (input, init) => {
          const response = await fetch(input, init);
          if (!response.ok) {
            let message = `Request failed (${response.status})`;
            try {
              const data = (await response.clone().json()) as {
                error?: string;
              };
              if (data.error) message = data.error;
            } catch {
              // keep status message
            }
            if (response.status === 429) {
              message =
                message ||
                "Too many requests. Wait a moment and try again.";
            }
            if (response.status === 503) {
              message =
                message ||
                "The model provider is unavailable. Try another model.";
            }
            throw new Error(message);
          }
          return response;
        },
      }),
    [conversationId, branchId]
  );

  const {
    messages,
    sendMessage,
    regenerate,
    status,
    stop,
    clearError,
    error,
  } = useChat({
    id: `${conversationId}:${branchId}`,
    messages: initialMessages,
    transport,
    onFinish: () => {
      setForceWebSearch(false);
      router.refresh();
    },
  });

  const busy = isChatBusy(status);
  const isThinking =
    status === "submitted" ||
    (status === "streaming" && messages.at(-1)?.role !== "assistant");

  useEffect(() => {
    if (pendingEditSent.current) return;
    const pending = readPendingEdit();
    if (
      !pending ||
      pending.conversationId !== conversationId ||
      pending.branchId !== branchId ||
      !pending.text.trim()
    ) {
      return;
    }

    pendingEditSent.current = true;
    sessionStorage.removeItem(PENDING_EDIT_KEY);
    void sendMessage({ text: pending.text });
  }, [conversationId, branchId, sendMessage]);

  useEffect(() => {
    if (pendingStarterSent.current || pendingEditSent.current) return;
    if (initialMessages.length > 0) return;

    const pending = readPendingStarterPrompt();
    if (
      !pending ||
      pending.conversationId !== conversationId ||
      !pending.text.trim()
    ) {
      return;
    }

    pendingStarterSent.current = true;
    clearPendingStarterPrompt();
    void sendMessage({ text: pending.text });
  }, [conversationId, initialMessages.length, sendMessage]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && busy) {
        event.preventDefault();
        stop();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, stop]);

  function handleBranchFromMessage(messageId: string) {
    if (busy || isBranching) {
      stop();
    }

    startBranchTransition(() => {
      void createBranchFromMessage({
        conversationId,
        sourceBranchId: branchId,
        messageId,
      }).then((branch) => {
        router.push(`/c/${conversationId}?branch=${branch.id}`);
        router.refresh();
      });
    });
  }

  function handleEditUserMessage(messageId: string, text: string) {
    if (busy || isBranching) {
      stop();
    }

    startBranchTransition(() => {
      void createBranchForEdit({
        conversationId,
        sourceBranchId: branchId,
        messageId,
      }).then((branch) => {
        sessionStorage.setItem(
          PENDING_EDIT_KEY,
          JSON.stringify({
            conversationId,
            branchId: branch.id,
            text,
          } satisfies PendingEdit)
        );
        router.push(`/c/${conversationId}?branch=${branch.id}`);
        router.refresh();
      });
    });
  }

  function handleRegenerate(messageId: string) {
    if (busy) return;
    void regenerate({ messageId });
  }

  function handleModelChange(nextModelId: string) {
    setModelId(nextModelId);
    void updateConversation({ id: conversationId, model: nextModelId }).then(
      () => router.refresh()
    );
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 sm:gap-3 sm:px-4">
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">
          {title}
        </h1>
        <form action={startNewChat}>
          <input type="hidden" name="notebookId" value={notebookId} />
          <button
            type="submit"
            title="Start another conversation in this notebook"
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs font-medium transition hover:bg-[var(--surface)] sm:text-sm"
          >
            + Chat
          </button>
        </form>
        <ShareControls
          conversationId={conversationId}
          initialShare={initialShare}
        />
        <BranchSwitcher
          conversationId={conversationId}
          activeBranchId={branchId}
          branches={branches}
        />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {messages.length === 0 && !isThinking ? (
          <div className="flex h-full items-center justify-center px-4 text-center text-sm text-[var(--muted)]">
            Ask a question about your sources
          </div>
        ) : (
          <ChatMessages
            messages={messages}
            isThinking={isThinking}
            busy={busy || isBranching}
            onBranchFromMessage={handleBranchFromMessage}
            onRegenerate={handleRegenerate}
            onEditUserMessage={handleEditUserMessage}
          />
        )}
      </div>

      {error ? (
        <div className="mx-3 mb-2 flex items-start justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300 sm:mx-4">
          <p className="min-w-0 flex-1">
            {error.message || "Chat request failed"}
            {/abort|cancel/i.test(error.message || "")
              ? " — generation was stopped."
              : ""}
          </p>
          <button
            type="button"
            onClick={() => clearError?.()}
            className="shrink-0 text-xs underline opacity-80 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <ChatComposer
        conversationId={conversationId}
        busy={busy}
        disabled={isBranching || models.length === 0}
        models={models}
        modelId={selectedModel?.id ?? modelId}
        onModelChange={handleModelChange}
        webSearchEnabled={webSearchEnabled}
        forceWebSearch={forceWebSearch && webSearchEnabled}
        onForceWebSearchChange={setForceWebSearch}
        visionEnabled={visionEnabled}
        onStop={() => stop()}
        onSend={({ text, files }) => {
          void sendMessage(
            files.length > 0 ? { text, files } : { text },
            {
              body: {
                forceWebSearch: forceWebSearch && webSearchEnabled,
              },
            }
          );
        }}
      />
    </div>
  );
}

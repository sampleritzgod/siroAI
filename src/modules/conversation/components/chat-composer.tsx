"use client";

import { useRef, useState } from "react";
import type { FileUIPart } from "ai";
import { cn } from "@/lib/utils";
import type { ModelDefinition } from "@/modules/ai/model-registry";
import {
  ALLOWED_MEDIA_TYPES,
  MAX_UPLOAD_BYTES,
} from "@/modules/files/constants";

export type ComposerAttachment = FileUIPart & {
  id: string;
  uploading?: boolean;
  error?: string;
};

type ChatComposerProps = {
  conversationId: string;
  disabled?: boolean;
  busy?: boolean;
  models: ModelDefinition[];
  modelId: string;
  onModelChange: (modelId: string) => void;
  webSearchEnabled: boolean;
  forceWebSearch: boolean;
  onForceWebSearchChange: (value: boolean) => void;
  visionEnabled: boolean;
  onSend: (payload: { text: string; files: FileUIPart[] }) => void;
  onStop: () => void;
};

export function ChatComposer({
  conversationId,
  disabled,
  busy,
  models,
  modelId,
  onModelChange,
  webSearchEnabled,
  forceWebSearch,
  onForceWebSearchChange,
  visionEnabled,
  onSend,
  onStop,
}: ChatComposerProps) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [uploadNotice, setUploadNotice] = useState<{
    tone: "error" | "info";
    message: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploading = attachments.some((item) => item.uploading);
  const readyFiles = attachments.filter(
    (item) => !item.uploading && !item.error
  );

  function submit() {
    const text = value.trim();
    if ((!text && readyFiles.length === 0) || disabled || busy || uploading) {
      return;
    }

    onSend({
      text: text || (readyFiles.length > 0 ? "See attached files." : ""),
      files: readyFiles.map((item) => ({
        type: "file" as const,
        mediaType: item.mediaType,
        filename: item.filename,
        url: item.url,
      })),
    });
    setValue("");
    setAttachments([]);
    setUploadNotice(null);
  }

  async function handleFilesSelected(fileList: FileList | null) {
    if (!fileList?.length) return;
    setUploadNotice(null);

    const selected = Array.from(fileList).slice(0, 5);
    for (const file of selected) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setUploadNotice({
          tone: "error",
          message: `“${file.name}” is too large (max 10MB).`,
        });
        continue;
      }

      const tempId = `tmp-${crypto.randomUUID()}`;
      setAttachments((prev) => [
        ...prev,
        {
          id: tempId,
          type: "file",
          mediaType: file.type || "application/octet-stream",
          filename: file.name,
          url: "",
          uploading: true,
        },
      ]);

      try {
        const form = new FormData();
        form.set("conversationId", conversationId);
        form.set("file", file);

        const response = await fetch("/api/files", {
          method: "POST",
          body: form,
        });

        const payload = (await response.json()) as {
          error?: string;
          id?: string;
          url?: string;
          mediaType?: string;
          filename?: string;
          usedVisionFallback?: boolean;
          pageImages?: number;
          indexedChunks?: number;
        };

        if (!response.ok || !payload.id || !payload.url || !payload.mediaType) {
          throw new Error(payload.error || "Upload failed");
        }

        if (payload.mediaType.startsWith("image/") && !visionEnabled) {
          setUploadNotice({
            tone: "error",
            message:
              "This model can’t see images — switch to a vision model, or attach PDF/text instead.",
          });
        } else if (payload.usedVisionFallback) {
          if (!visionEnabled) {
            setUploadNotice({
              tone: "error",
              message:
                "This PDF is image-based (no text). Switch to a vision model like GPT-4o mini.",
            });
          } else {
            setUploadNotice({
              tone: "info",
              message: `PDF has no text layer — prepared ${payload.pageImages ?? 0} page image(s) for the model.`,
            });
          }
        } else if ((payload.indexedChunks ?? 0) > 0) {
          setUploadNotice({
            tone: "info",
            message: `Indexed ${payload.indexedChunks} chunk(s) for document search.`,
          });
        }

        setAttachments((prev) =>
          prev.map((item) =>
            item.id === tempId
              ? {
                  id: payload.id!,
                  type: "file" as const,
                  mediaType: payload.mediaType!,
                  filename: payload.filename || file.name,
                  url: payload.url!,
                }
              : item
          )
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Upload failed";
        setAttachments((prev) => prev.filter((item) => item.id !== tempId));
        setUploadNotice({ tone: "error", message });
      }
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <div className="border-t border-[var(--border)] bg-[var(--background)]/90 px-3 py-3 backdrop-blur sm:px-4 sm:py-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2 px-0.5">
          <label className="min-w-0 flex-1 sm:flex-none">
            <span className="sr-only">Model</span>
            <select
              value={modelId}
              disabled={disabled || busy || models.length === 0}
              onChange={(event) => onModelChange(event.target.value)}
              className="w-full max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--foreground)] outline-none disabled:opacity-50 sm:w-auto"
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={disabled || busy || !webSearchEnabled}
            title={
              webSearchEnabled
                ? "Force web search on this turn"
                : "Web search unavailable for this model or missing TAVILY_API_KEY"
            }
            onClick={() => onForceWebSearchChange(!forceWebSearch)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition",
              forceWebSearch && webSearchEnabled
                ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]",
              (!webSearchEnabled || disabled || busy) &&
                "cursor-not-allowed opacity-40"
            )}
          >
            Search
          </button>

          <button
            type="button"
            disabled={disabled || busy || uploading}
            title="Attach image, PDF, or text (max 10MB)"
            onClick={() => fileInputRef.current?.click()}
            className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--muted)] transition hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Attach
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_MEDIA_TYPES.join(",")}
            multiple
            className="hidden"
            onChange={(event) => void handleFilesSelected(event.target.files)}
          />
        </div>

        {attachments.length > 0 ? (
          <ul className="flex flex-wrap gap-2 px-0.5">
            {attachments.map((item) => (
              <li
                key={item.id}
                className="flex max-w-full items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs"
              >
                <span className="truncate text-[var(--foreground)]">
                  {item.uploading
                    ? `Uploading ${item.filename ?? "file"}…`
                    : item.filename ?? "file"}
                </span>
                {!item.uploading ? (
                  <button
                    type="button"
                    className="text-[var(--muted)] hover:text-[var(--foreground)]"
                    onClick={() =>
                      setAttachments((prev) =>
                        prev.filter((row) => row.id !== item.id)
                      )
                    }
                  >
                    ✕
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {uploadNotice ? (
          <p
            className={cn(
              "px-0.5 text-xs",
              uploadNotice.tone === "error"
                ? "text-red-600"
                : "text-[var(--muted)]"
            )}
          >
            {uploadNotice.message}
          </p>
        ) : null}

        <div className="flex items-end gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-sm">
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="Message SiroAI…"
            rows={1}
            disabled={disabled}
            className="max-h-40 min-h-11 w-0 flex-1 resize-none bg-transparent px-2 py-2.5 text-[15px] outline-none placeholder:text-[var(--muted)] disabled:opacity-50 sm:px-3"
          />

          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="shrink-0 rounded-xl bg-[var(--foreground)] px-3 py-2.5 text-sm font-medium text-[var(--background)] transition hover:opacity-90 sm:px-4"
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={
                disabled ||
                uploading ||
                (!value.trim() && readyFiles.length === 0)
              }
              className={cn(
                "shrink-0 rounded-xl bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-white transition sm:px-4",
                "hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              )}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

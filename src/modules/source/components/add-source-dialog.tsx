"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  MAX_UPLOAD_BYTES,
  SOURCE_ALLOWED_MEDIA_TYPES,
  resolveSourceMediaType,
} from "@/modules/source/constants";

const UPLOAD_STEPS = [
  "Uploading file…",
  "Storing file…",
  "Extracting text…",
  "Queuing indexing…",
] as const;

const WEBSITE_STEPS = [
  "Fetching page…",
  "Extracting readable text…",
  "Queuing indexing…",
] as const;

const YOUTUBE_STEPS = [
  "Fetching video…",
  "Downloading transcript…",
  "Queuing indexing…",
] as const;

type AddSourceDialogProps = {
  open: boolean;
  notebookId: string | null;
  onClose: () => void;
  onUploaded: () => void;
};

export function AddSourceDialog({
  open,
  notebookId,
  onClose,
  onUploaded,
}: AddSourceDialogProps) {
  if (!open || !notebookId) return null;

  return (
    <AddSourceDialogForm
      key={notebookId}
      notebookId={notebookId}
      onClose={onClose}
      onUploaded={onUploaded}
    />
  );
}

function AddSourceDialogForm({
  notebookId,
  onClose,
  onUploaded,
}: {
  notebookId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const titleId = useId();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const vttInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"menu" | "website" | "youtube">("menu");
  const [remoteUrl, setRemoteUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [progressKind, setProgressKind] = useState<
    "file" | "website" | "youtube"
  >("file");

  const progressSteps =
    progressKind === "youtube"
      ? YOUTUBE_STEPS
      : progressKind === "website"
        ? WEBSITE_STEPS
        : UPLOAD_STEPS;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isUploading) {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isUploading, onClose]);

  useEffect(() => {
    if (!isUploading) return;

    const delays =
      progressKind === "file" ? [400, 900, 1600] : [500, 1200];
    const stepTimers = delays.map((delay, index) =>
      window.setTimeout(() => setStepIndex(index + 1), delay)
    );
    const tick = window.setInterval(() => {
      setElapsedSec((value) => value + 1);
    }, 1000);

    return () => {
      for (const timer of stepTimers) window.clearTimeout(timer);
      window.clearInterval(tick);
    };
  }, [isUploading, progressKind]);

  // Reset progress UI when upload ends (avoid setState-in-effect on the idle path).
  const displayStepIndex = isUploading ? stepIndex : 0;
  const displayElapsedSec = isUploading ? elapsedSec : 0;

  function validateFile(file: File): string | null {
    if (!file.size) {
      return "File is empty.";
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return `File too large. Maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`;
    }
    const mediaType = resolveSourceMediaType({
      filename: file.name,
      fileType: file.type,
    });
    if (!mediaType) {
      return "Unsupported file type. Only PDF, plain text, and VTT subtitles are allowed.";
    }
    return null;
  }

  async function uploadFile(file: File | undefined) {
    if (!file || isUploading) return;

    const validationError = validateFile(file);
    if (validationError) {
      setError(validationError);
      return;
    }

    if (!notebookId.trim()) {
      setError("Notebook not found");
      return;
    }

    setError(null);
    setProgressKind("file");
    setActiveLabel(file.name);
    setStepIndex(0);
    setElapsedSec(0);
    setIsUploading(true);

    try {
      const mediaType =
        resolveSourceMediaType({
          filename: file.name,
          fileType: file.type,
        }) ?? file.type;

      // Prefer browser → S3 direct upload (avoids Vercel’s 4.5MB body limit).
      const presignResponse = await fetch("/api/sources/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebookId,
          filename: file.name,
          contentType: mediaType,
          size: file.size,
        }),
      });

      if (presignResponse.ok) {
        const presign = (await presignResponse.json()) as {
          sourceId?: string;
          uploadUrl?: string;
          mediaType?: string;
          error?: string;
        };

        if (!presign.sourceId || !presign.uploadUrl) {
          setError(presign.error || "Could not start upload");
          return;
        }

        const putResponse = await fetch(presign.uploadUrl, {
          method: "PUT",
          body: file,
          headers: {
            "Content-Type": presign.mediaType || mediaType,
          },
        });

        if (!putResponse.ok) {
          setError(
            "Could not upload file to storage. If this persists, check S3 CORS for this site."
          );
          return;
        }

        const completeResponse = await fetch("/api/sources/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceId: presign.sourceId,
            notebookId,
          }),
        });

        await handleSourceResponse(completeResponse);
        return;
      }

      // S3 not configured (501) or small-file fallback: multipart through the API.
      if (presignResponse.status !== 501) {
        const payload = (await presignResponse.json().catch(() => null)) as {
          error?: string;
        } | null;
        if (presignResponse.status === 413 || payload?.error) {
          setError(
            payload?.error ||
              `File too large. Maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`
          );
          return;
        }
      }

      const form = new FormData();
      form.set("notebookId", notebookId);
      form.set("file", file);

      const response = await fetch("/api/sources", {
        method: "POST",
        body: form,
      });

      await handleSourceResponse(response);
    } catch {
      setError("Network error during upload");
    } finally {
      setIsUploading(false);
      setActiveLabel(null);
    }
  }

  async function submitRemoteUrl(kind: "website" | "youtube") {
    if (isUploading) return;

    const url = remoteUrl.trim();
    if (!url) {
      setError(kind === "youtube" ? "Invalid YouTube URL" : "Invalid URL");
      return;
    }
    if (!notebookId.trim()) {
      setError("Notebook not found");
      return;
    }

    setError(null);
    setProgressKind(kind);
    setActiveLabel(url);
    setStepIndex(0);
    setElapsedSec(0);
    setIsUploading(true);

    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebookId, url }),
      });

      await handleSourceResponse(response);
    } catch {
      setError(
        kind === "youtube"
          ? "Network error while fetching YouTube video"
          : "Network error while fetching website"
      );
    } finally {
      setIsUploading(false);
      setActiveLabel(null);
    }
  }

  async function handleSourceResponse(response: Response) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      if (response.status === 401) {
        setError("Unauthorized");
        return;
      }
      if (response.status === 404) {
        setError(payload?.error || "Notebook not found");
        return;
      }
      setError(
        payload?.error ||
          (response.status === 413
            ? `File too large. Maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`
            : response.status === 415
              ? "Unsupported file type. Only PDF, plain text, and VTT subtitles are allowed."
              : response.status === 409
                ? "This source is already added to the notebook."
                : response.status === 422
                  ? "Could not extract content from this source"
                  : "Unexpected server error")
      );
      return;
    }

    onUploaded();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/40"
        disabled={isUploading}
        onClick={onClose}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={isUploading}
        className="relative z-[61] w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-xl"
      >
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {isUploading
            ? progressKind === "youtube"
              ? "Adding YouTube video"
              : progressKind === "website"
                ? "Adding website"
                : "Uploading source"
            : mode === "youtube"
              ? "Add YouTube"
              : mode === "website"
                ? "Add Website"
                : "Add Source"}
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {isUploading
            ? activeLabel
              ? `Working on “${activeLabel}”…`
              : "Please wait…"
            : mode === "youtube"
              ? "Paste a youtube.com or youtu.be link. The transcript will be indexed for chat."
              : mode === "website"
                ? "Paste a public page URL. Readable text will be indexed for chat."
                : "Upload a PDF, text, or .vtt subtitle file, or add a website / YouTube URL."}
        </p>

        {isUploading ? (
          <div className="mt-5" aria-live="polite">
            <div className="mb-4 flex items-center gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-3 py-3">
              <span
                className="size-5 shrink-0 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent"
                aria-hidden="true"
              />
              <div className="min-w-0 text-left">
                <p className="truncate text-sm font-medium text-[var(--foreground)]">
                  {
                    progressSteps[
                      Math.min(displayStepIndex, progressSteps.length - 1)
                    ]
                  }
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {displayElapsedSec < 1
                    ? "Starting…"
                    : `${displayElapsedSec}s elapsed · usually under 20s`}
                </p>
              </div>
            </div>

            <ol className="space-y-2">
              {progressSteps.map((step, index) => {
                const done = index < displayStepIndex;
                const active = index === displayStepIndex;
                return (
                  <li
                    key={step}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                      active
                        ? "border-[var(--accent)]/40 bg-[var(--accent)]/5 text-[var(--foreground)]"
                        : done
                          ? "border-[var(--border)] text-[var(--foreground)]"
                          : "border-[var(--border)] text-[var(--muted)]"
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-medium",
                        done || active
                          ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                          : "bg-[var(--sidebar)] text-[var(--muted)]"
                      )}
                      aria-hidden="true"
                    >
                      {done ? "✓" : index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : mode === "website" || mode === "youtube" ? (
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitRemoteUrl(mode);
            }}
          >
            <label className="text-xs font-medium text-[var(--muted)]">
              {mode === "youtube" ? "YouTube URL" : "Website URL"}
              <input
                type="url"
                inputMode="url"
                autoFocus
                placeholder={
                  mode === "youtube"
                    ? "https://www.youtube.com/watch?v=…"
                    : "https://example.com/article"
                }
                value={remoteUrl}
                onChange={(event) => setRemoteUrl(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-[var(--border)] bg-[var(--background)] px-3 py-2.5 text-sm text-[var(--foreground)] outline-none ring-[var(--accent)] focus:ring-2"
              />
            </label>
            <button
              type="submit"
              className="rounded-xl bg-[var(--accent)] px-3 py-2.5 text-sm font-medium text-white hover:opacity-90"
            >
              {mode === "youtube" ? "Add YouTube" : "Add Website"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("menu");
                setRemoteUrl("");
                setError(null);
              }}
              className="text-left text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
            >
              ← Back to source types
            </button>
          </form>
        ) : (
          <div className="mt-4 flex flex-col gap-2">
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(event) => {
                void uploadFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <input
              ref={textInputRef}
              type="file"
              accept="text/plain,.txt"
              className="hidden"
              onChange={(event) => {
                void uploadFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            <input
              ref={vttInputRef}
              type="file"
              accept="text/vtt,.vtt"
              className="hidden"
              onChange={(event) => {
                void uploadFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            <button
              type="button"
              onClick={() => pdfInputRef.current?.click()}
              className="rounded-xl border border-[var(--border)] px-3 py-3 text-left text-sm font-medium transition hover:bg-[var(--sidebar)]"
            >
              Upload PDF
            </button>
            <button
              type="button"
              onClick={() => textInputRef.current?.click()}
              className="rounded-xl border border-[var(--border)] px-3 py-3 text-left text-sm font-medium transition hover:bg-[var(--sidebar)]"
            >
              Upload Text File
            </button>
            <button
              type="button"
              onClick={() => vttInputRef.current?.click()}
              className="rounded-xl border border-[var(--border)] px-3 py-3 text-left text-sm font-medium transition hover:bg-[var(--sidebar)]"
            >
              Upload Subtitles (.vtt)
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("website");
                setRemoteUrl("");
                setError(null);
              }}
              className="rounded-xl border border-[var(--border)] px-3 py-3 text-left text-sm font-medium transition hover:bg-[var(--sidebar)]"
            >
              Add Website
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("youtube");
                setRemoteUrl("");
                setError(null);
              }}
              className="rounded-xl border border-[var(--border)] px-3 py-3 text-left text-sm font-medium transition hover:bg-[var(--sidebar)]"
            >
              Add YouTube
            </button>

            <p className="text-[11px] text-[var(--muted)]">
              Files: {SOURCE_ALLOWED_MEDIA_TYPES.join(", ")} (max{" "}
              {MAX_UPLOAD_BYTES / (1024 * 1024)}MB) · Websites &amp;
              YouTube: public http(s) links
            </p>
          </div>
        )}

        {error ? (
          <p className="mt-3 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--sidebar)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isUploading ? "Working…" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

import {
  YoutubeTranscript,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
  type TranscriptConfig,
  type TranscriptResponse,
} from "youtube-transcript";
import { SOURCE_TITLE_MAX_LENGTH } from "@/modules/source/constants";

/** Injectable for tests — defaults to the youtube-transcript package. */
export const youtubeTranscriptClient = {
  fetchTranscript: (
    videoId: string,
    config?: TranscriptConfig
  ): Promise<TranscriptResponse[]> =>
    YoutubeTranscript.fetchTranscript(videoId, config),
};

export const YOUTUBE_FETCH_TIMEOUT_MS = 20_000;
export const YOUTUBE_MIN_TRANSCRIPT_CHARS = 40;

export type YoutubeSourceMetadata = {
  videoId: string;
  channel: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
};

export type FetchedYoutube = {
  url: string;
  videoId: string;
  title: string;
  channel: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  transcript: string;
  transcriptBytes: number;
};

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

/**
 * True when the URL points at youtube.com or youtu.be.
 */
export function isYoutubeUrl(raw: string): boolean {
  try {
    extractYoutubeVideoId(raw);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract an 11-char YouTube video id from common URL shapes.
 */
export function extractYoutubeVideoId(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Invalid YouTube URL");
  }

  if (VIDEO_ID_RE.test(trimmed)) {
    return trimmed;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("Invalid YouTube URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Unsupported YouTube URL");
  }

  const host = parsed.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) {
    throw new Error("Unsupported YouTube URL");
  }

  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = parsed.pathname.replace(/^\//, "").split("/")[0] ?? "";
    if (!VIDEO_ID_RE.test(id)) {
      throw new Error("Invalid YouTube URL");
    }
    return id;
  }

  const watchId = parsed.searchParams.get("v");
  if (watchId && VIDEO_ID_RE.test(watchId)) {
    return watchId;
  }

  const parts = parsed.pathname.split("/").filter(Boolean);
  // /embed/ID, /shorts/ID, /live/ID, /v/ID
  if (
    parts.length >= 2 &&
    ["embed", "shorts", "live", "v"].includes(parts[0]!.toLowerCase())
  ) {
    const id = parts[1]!;
    if (VIDEO_ID_RE.test(id)) return id;
  }

  throw new Error("Invalid YouTube URL");
}

/**
 * Canonical watch URL used for storage + duplicate detection.
 */
export function normalizeYoutubeUrl(raw: string): string {
  const videoId = extractYoutubeVideoId(raw);
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/**
 * Fetch video metadata (oEmbed) + transcript, then clean into plain text.
 */
export async function fetchYoutubeContent(
  rawUrl: string,
  options?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<FetchedYoutube> {
  const videoId = extractYoutubeVideoId(rawUrl);
  const url = normalizeYoutubeUrl(videoId);
  const timeoutMs = options?.timeoutMs ?? YOUTUBE_FETCH_TIMEOUT_MS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onAbort);

  try {
    const [meta, segments] = await Promise.all([
      fetchYoutubeOEmbed(url, controller.signal),
      fetchYoutubeTranscript(videoId, controller.signal),
    ]);

    const transcript = cleanTranscript(segments);
    if (transcript.length < YOUTUBE_MIN_TRANSCRIPT_CHARS) {
      throw new Error("No transcript available for this video");
    }

    const durationSeconds = estimateDurationSeconds(segments);

    return {
      url,
      videoId,
      title: (meta.title || `YouTube ${videoId}`).slice(0, SOURCE_TITLE_MAX_LENGTH),
      channel: meta.channel,
      thumbnailUrl: meta.thumbnailUrl,
      durationSeconds,
      transcript,
      transcriptBytes: Buffer.byteLength(transcript, "utf8"),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || /aborted|timeout/i.test(error.message))
    ) {
      throw new Error("YouTube transcript fetch timed out");
    }
    throw error instanceof Error
      ? error
      : new Error("YouTube transcript fetch failed");
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

async function fetchYoutubeOEmbed(
  watchUrl: string,
  signal: AbortSignal
): Promise<{
  title: string | null;
  channel: string | null;
  thumbnailUrl: string | null;
}> {
  const oembed = new URL("https://www.youtube.com/oembed");
  oembed.searchParams.set("url", watchUrl);
  oembed.searchParams.set("format", "json");

  let response: Response;
  try {
    response = await fetch(oembed.toString(), {
      method: "GET",
      signal,
      headers: { Accept: "application/json" },
    });
  } catch {
    // Metadata is best-effort; transcript is required.
    return { title: null, channel: null, thumbnailUrl: null };
  }

  if (response.status === 401 || response.status === 403) {
    throw new Error("Private or restricted YouTube video");
  }
  if (response.status === 404) {
    throw new Error("YouTube video not found or deleted");
  }
  if (!response.ok) {
    return { title: null, channel: null, thumbnailUrl: null };
  }

  const data = (await response.json().catch(() => null)) as {
    title?: string;
    author_name?: string;
    thumbnail_url?: string;
  } | null;

  return {
    title: data?.title?.trim() || null,
    channel: data?.author_name?.trim() || null,
    thumbnailUrl: data?.thumbnail_url?.trim() || null,
  };
}

async function fetchYoutubeTranscript(
  videoId: string,
  signal: AbortSignal
): Promise<TranscriptResponse[]> {
  try {
    return await youtubeTranscriptClient.fetchTranscript(videoId, {
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          signal: signal ?? init?.signal,
        }),
    });
  } catch (error) {
    throw mapTranscriptError(error, videoId);
  }
}

function mapTranscriptError(error: unknown, videoId: string): Error {
  if (error instanceof YoutubeTranscriptVideoUnavailableError) {
    return new Error("YouTube video not found or deleted");
  }
  if (error instanceof YoutubeTranscriptDisabledError) {
    return new Error("No transcript available for this video");
  }
  if (error instanceof YoutubeTranscriptNotAvailableError) {
    return new Error("No transcript available for this video");
  }
  if (error instanceof YoutubeTranscriptTooManyRequestError) {
    return new Error("YouTube transcript fetch failed (rate limited)");
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/private|unavailable|deleted/i.test(message)) {
    if (/private/i.test(message)) {
      return new Error("Private or restricted YouTube video");
    }
    return new Error("YouTube video not found or deleted");
  }
  if (/disabled|not available|transcript/i.test(message)) {
    return new Error("No transcript available for this video");
  }

  return new Error(
    `YouTube transcript fetch failed${videoId ? ` (${videoId})` : ""}`
  );
}

function cleanTranscript(segments: TranscriptResponse[]): string {
  const lines = segments
    .map((segment) =>
      segment.text
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#39;/gi, "'")
        .replace(/&quot;/gi, '"')
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);

  // Drop consecutive duplicate lines (common in auto-captions).
  const deduped: string[] = [];
  for (const line of lines) {
    if (deduped[deduped.length - 1]?.toLowerCase() === line.toLowerCase()) {
      continue;
    }
    deduped.push(line);
  }

  return deduped.join(" ").replace(/\s+/g, " ").trim();
}

function estimateDurationSeconds(
  segments: TranscriptResponse[]
): number | null {
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1]!;
  const endMs = (last.offset ?? 0) + (last.duration ?? 0);
  if (!Number.isFinite(endMs) || endMs <= 0) return null;
  return Math.max(1, Math.round(endMs / 1000));
}

export function toYoutubeMetadata(
  video: FetchedYoutube
): YoutubeSourceMetadata {
  return {
    videoId: video.videoId,
    channel: video.channel,
    thumbnailUrl: video.thumbnailUrl,
    durationSeconds: video.durationSeconds,
  };
}

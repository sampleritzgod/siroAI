import {
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptVideoUnavailableError,
  type TranscriptConfig,
  type TranscriptResponse,
} from "youtube-transcript";
import { SOURCE_TITLE_MAX_LENGTH } from "@/modules/source/constants";

export const YOUTUBE_FETCH_TIMEOUT_MS = 45_000;
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

type CaptionTrack = {
  baseUrl?: string;
  languageCode?: string;
  name?: { simpleText?: string };
  kind?: string;
};

type InnertubeClient = {
  clientName: string;
  clientVersion: string;
  userAgent: string;
};

/**
 * Multiple InnerTube clients — datacenter IPs (e.g. Vercel) often fail on
 * ANDROID alone while WEB / IOS still return caption tracks.
 */
const INNERTUBE_CLIENTS: InnertubeClient[] = [
  {
    clientName: "WEB",
    clientVersion: "2.20250313.00.00",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  },
  {
    clientName: "ANDROID",
    clientVersion: "20.10.38",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14)",
  },
  {
    clientName: "IOS",
    clientVersion: "20.10.4",
    userAgent:
      "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
  },
  {
    clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    clientVersion: "2.0",
    userAgent: "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version",
  },
];

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const RE_XML_CLASSIC =
  /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;

/** Injectable for tests. */
export const youtubeTranscriptClient = {
  fetchTranscript: fetchTranscriptRobust,
};

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
    // Metadata is best-effort; do not fail the whole ingest if oEmbed fails.
    const metaPromise = fetchYoutubeOEmbed(url, controller.signal).catch(
      () => ({
        title: null as string | null,
        channel: null as string | null,
        thumbnailUrl: null as string | null,
      })
    );

    const [meta, segments] = await Promise.all([
      metaPromise,
      youtubeTranscriptClient.fetchTranscript(videoId, {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: controller.signal,
          }),
      }),
    ]);

    const transcript = cleanTranscript(segments);
    if (transcript.length < YOUTUBE_MIN_TRANSCRIPT_CHARS) {
      throw new Error("No transcript available for this video");
    }

    return {
      url,
      videoId,
      title: (meta.title || `YouTube ${videoId}`).slice(
        0,
        SOURCE_TITLE_MAX_LENGTH
      ),
      channel: meta.channel,
      thumbnailUrl: meta.thumbnailUrl,
      durationSeconds: estimateDurationSeconds(segments),
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
    throw mapTranscriptError(error, videoId);
  } finally {
    clearTimeout(timeout);
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

/**
 * Robust transcript fetch:
 * 1) Multi-client InnerTube (works better from cloud IPs)
 * 2) Watch-page caption scrape
 * 3) Prefer English / asr auto-captions when present
 */
async function fetchTranscriptRobust(
  videoId: string,
  config?: TranscriptConfig
): Promise<TranscriptResponse[]> {
  const identifier = VIDEO_ID_RE.test(videoId)
    ? videoId
    : extractYoutubeVideoId(videoId);
  const fetchFn = config?.fetch ?? fetch;

  const errors: string[] = [];

  for (const client of INNERTUBE_CLIENTS) {
    try {
      const tracks = await fetchCaptionTracksViaInnertube(
        identifier,
        client,
        fetchFn
      );
      if (!tracks?.length) {
        errors.push(`${client.clientName}: no caption tracks`);
        continue;
      }
      const segments = await downloadCaptionTrack(
        tracks,
        identifier,
        fetchFn,
        config?.lang
      );
      if (segments.length > 0) return segments;
      errors.push(`${client.clientName}: empty caption body`);
    } catch (error) {
      errors.push(
        `${client.clientName}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  try {
    const tracks = await fetchCaptionTracksViaWatchPage(
      identifier,
      fetchFn,
      config?.lang
    );
    if (tracks?.length) {
      const segments = await downloadCaptionTrack(
        tracks,
        identifier,
        fetchFn,
        config?.lang
      );
      if (segments.length > 0) return segments;
      errors.push("watch-page: empty caption body");
    } else {
      errors.push("watch-page: no caption tracks");
    }
  } catch (error) {
    errors.push(
      `watch-page: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const joined = errors.join(" | ");
  if (/captcha|too many requests|rate.?limit/i.test(joined)) {
    throw new YoutubeTranscriptTooManyRequestError();
  }
  if (/unavailable|not found|private|login/i.test(joined)) {
    throw new YoutubeTranscriptVideoUnavailableError(identifier);
  }
  // Prefer "disabled/not available" only when every strategy saw empty tracks.
  if (
    errors.every((item) => /no caption tracks|empty caption body/i.test(item))
  ) {
    throw new YoutubeTranscriptDisabledError(identifier);
  }

  throw new Error(
    `YouTube transcript fetch failed (${identifier}): ${joined.slice(0, 400)}`
  );
}

async function fetchCaptionTracksViaInnertube(
  videoId: string,
  client: InnertubeClient,
  fetchFn: typeof fetch
): Promise<CaptionTrack[] | null> {
  const response = await fetchFn(
    "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": client.userAgent,
        "X-Youtube-Client-Name":
          client.clientName === "WEB"
            ? "1"
            : client.clientName === "ANDROID"
              ? "3"
              : client.clientName === "IOS"
                ? "5"
                : "85",
        "X-Youtube-Client-Version": client.clientVersion,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: client.clientName,
            clientVersion: client.clientVersion,
            hl: "en",
            gl: "US",
          },
        },
        videoId,
        contentCheckOk: true,
        racyCheckOk: true,
      }),
    }
  );

  if (!response.ok) return null;

  const data = (await response.json()) as {
    playabilityStatus?: { status?: string; reason?: string };
    captions?: {
      playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
    };
  };

  const status = data.playabilityStatus?.status;
  if (status && status !== "OK") {
    const reason = data.playabilityStatus?.reason ?? status;
    if (/private|login/i.test(reason)) {
      throw new Error(`private: ${reason}`);
    }
    if (/unavailable|removed|deleted/i.test(reason)) {
      throw new Error(`unavailable: ${reason}`);
    }
    return null;
  }

  const tracks =
    data.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? null;
  return Array.isArray(tracks) && tracks.length > 0 ? tracks : null;
}

async function fetchCaptionTracksViaWatchPage(
  videoId: string,
  fetchFn: typeof fetch,
  lang?: string
): Promise<CaptionTrack[] | null> {
  const response = await fetchFn(
    `https://www.youtube.com/watch?v=${videoId}&hl=en`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": lang ? `${lang},en;q=0.9` : "en-US,en;q=0.9",
      },
    }
  );

  const html = await response.text();
  if (html.includes('class="g-recaptcha"')) {
    throw new YoutubeTranscriptTooManyRequestError();
  }

  const player = extractYtInitialPlayerResponse(html);
  const tracks =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? null;
  return Array.isArray(tracks) && tracks.length > 0 ? tracks : null;
}

function extractYtInitialPlayerResponse(html: string): {
  captions?: {
    playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] };
  };
} | null {
  const markers = [
    "ytInitialPlayerResponse = ",
    "var ytInitialPlayerResponse = ",
  ];
  for (const marker of markers) {
    const start = html.indexOf(marker);
    if (start === -1) continue;
    const jsonStart = start + marker.length;
    let depth = 0;
    for (let i = jsonStart; i < html.length; i++) {
      const ch = html[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(html.slice(jsonStart, i + 1));
          } catch {
            return null;
          }
        }
      }
    }
  }
  return null;
}

async function downloadCaptionTrack(
  tracks: CaptionTrack[],
  videoId: string,
  fetchFn: typeof fetch,
  preferredLang?: string
): Promise<TranscriptResponse[]> {
  const track = selectCaptionTrack(tracks, preferredLang);
  if (!track?.baseUrl) {
    throw new YoutubeTranscriptNotAvailableError(videoId);
  }

  let captionUrl: URL;
  try {
    captionUrl = new URL(track.baseUrl);
  } catch {
    throw new YoutubeTranscriptNotAvailableError(videoId);
  }

  if (!captionUrl.hostname.endsWith("youtube.com")) {
    throw new YoutubeTranscriptNotAvailableError(videoId);
  }

  // Prefer srv3 JSON-ish XML which is more reliable than classic timedtext.
  if (!captionUrl.searchParams.has("fmt")) {
    captionUrl.searchParams.set("fmt", "srv3");
  }

  const response = await fetchFn(captionUrl.toString(), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Accept-Language": preferredLang
        ? `${preferredLang},en;q=0.9`
        : "en-US,en;q=0.9",
    },
  });

  if (!response.ok) {
    throw new YoutubeTranscriptNotAvailableError(videoId);
  }

  const body = await response.text();
  return parseTranscriptXml(body, track.languageCode ?? preferredLang ?? "en");
}

function selectCaptionTrack(
  tracks: CaptionTrack[],
  preferredLang?: string
): CaptionTrack | undefined {
  if (preferredLang) {
    const exact = tracks.find((track) => track.languageCode === preferredLang);
    if (exact) return exact;
  }

  const english =
    tracks.find((track) => track.languageCode === "en") ||
    tracks.find((track) => track.languageCode?.startsWith("en"));
  if (english) return english;

  // Prefer manual captions over auto-generated when picking a fallback.
  const manual = tracks.find((track) => track.kind !== "asr");
  return manual ?? tracks[0];
}

function parseTranscriptXml(
  xml: string,
  lang: string
): TranscriptResponse[] {
  const results: TranscriptResponse[] = [];

  const pRegex = /<p\s+t="(\d+)"\s+d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let match: RegExpExecArray | null;
  while ((match = pRegex.exec(xml)) !== null) {
    const startMs = Number.parseInt(match[1]!, 10);
    const durMs = Number.parseInt(match[2]!, 10);
    const inner = match[3]!;
    let text = "";
    const sRegex = /<s[^>]*>([^<]*)<\/s>/g;
    let sMatch: RegExpExecArray | null;
    while ((sMatch = sRegex.exec(inner)) !== null) {
      text += sMatch[1];
    }
    if (!text) {
      text = inner.replace(/<[^>]+>/g, "");
    }
    text = decodeEntities(text).trim();
    if (text) {
      results.push({
        text,
        duration: durMs,
        offset: startMs,
        lang,
      });
    }
  }

  if (results.length > 0) return results;

  return [...xml.matchAll(RE_XML_CLASSIC)].map((result) => ({
    text: decodeEntities(result[3] ?? ""),
    duration: Number.parseFloat(result[2] ?? "0") * 1000,
    offset: Number.parseFloat(result[1] ?? "0") * 1000,
    lang,
  }));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10))
    );
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
    return new Error(
      "YouTube temporarily blocked transcript access from this server. Try again shortly."
    );
  }

  if (error instanceof Error) {
    // Preserve already-mapped product errors.
    if (
      /no transcript available|private or restricted|not found or deleted|timed out|rate limited|blocked transcript/i.test(
        error.message
      )
    ) {
      return error;
    }
    if (/private/i.test(error.message)) {
      return new Error("Private or restricted YouTube video");
    }
    if (/unavailable|deleted|not found/i.test(error.message)) {
      return new Error("YouTube video not found or deleted");
    }
    if (/disabled|no caption tracks/i.test(error.message)) {
      return new Error("No transcript available for this video");
    }
    return new Error(
      `YouTube transcript fetch failed (${videoId}): ${error.message.slice(0, 240)}`
    );
  }

  return new Error(`YouTube transcript fetch failed (${videoId})`);
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
  // InnerTube srv3 offsets are milliseconds; classic timedtext used seconds*1000 above.
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

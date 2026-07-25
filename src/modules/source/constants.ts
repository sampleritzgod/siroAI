import { MAX_UPLOAD_BYTES } from "@/modules/files/constants";

export { MAX_UPLOAD_BYTES };

/** Source library file uploads (website / YouTube use the URL path). */
export const SOURCE_ALLOWED_MEDIA_TYPES = [
  "application/pdf",
  "text/plain",
  "text/vtt",
] as const;

export type SourceAllowedMediaType =
  (typeof SOURCE_ALLOWED_MEDIA_TYPES)[number];

export const SOURCE_TITLE_MAX_LENGTH = 100;

/** Sentinel storagePath for website sources (not a blob/local file key). */
export const WEBSITE_STORAGE_PATH = "website";

/** Sentinel storagePath for YouTube sources (not a blob/local file key). */
export const YOUTUBE_STORAGE_PATH = "youtube";

const SENTINEL_STORAGE_PATHS = new Set([
  WEBSITE_STORAGE_PATH,
  YOUTUBE_STORAGE_PATH,
  "pending",
]);

/** True when storagePath is not a real local key or blob URL. */
export function isSentinelStoragePath(storagePath: string): boolean {
  return SENTINEL_STORAGE_PATHS.has(storagePath);
}

/** Shown when YouTube blocks caption fetches from cloud IPs (e.g. Vercel). */
export const CLOUD_YOUTUBE_BLOCKED_MESSAGE =
  "YouTube blocked transcript access from this server. Add SUPADATA_API_KEY (free at https://supadata.ai) in Vercel env, then redeploy.";

export function isSourceAllowedMediaType(
  value: string
): value is SourceAllowedMediaType {
  return (SOURCE_ALLOWED_MEDIA_TYPES as readonly string[]).includes(value);
}

export function sourceTypeFromMediaType(
  mediaType: SourceAllowedMediaType
): "PDF" | "TEXT" | "VTT" {
  if (mediaType === "application/pdf") return "PDF";
  if (mediaType === "text/vtt") return "VTT";
  return "TEXT";
}

export function defaultTitleFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, "").trim() || "Untitled source";
  return base.slice(0, SOURCE_TITLE_MAX_LENGTH);
}

export function isRemoteStoragePath(storagePath: string): boolean {
  return (
    storagePath.startsWith("https://") || storagePath.startsWith("http://")
  );
}

/**
 * Resolve a source MIME type from the browser File.
 * Many browsers leave `file.type` empty (or octet-stream) for .txt/.pdf/.vtt —
 * fall back to the filename extension so uploads are not rejected.
 */
export function resolveSourceMediaType(input: {
  filename: string;
  fileType?: string | null;
}): SourceAllowedMediaType | null {
  const lowerName = input.filename.trim().toLowerCase();

  // Extension wins for .vtt: browsers often report it as text/plain, which
  // would skip subtitle parsing and embed raw timestamps.
  if (lowerName.endsWith(".vtt")) return "text/vtt";

  const declared = (input.fileType ?? "").trim().toLowerCase();
  if (isSourceAllowedMediaType(declared)) {
    return declared;
  }

  if (lowerName.endsWith(".pdf")) return "application/pdf";
  if (lowerName.endsWith(".txt")) return "text/plain";

  return null;
}

export function formatSourceUploadError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "Unexpected upload error";

  if (/unauthorized|signed in|auth/i.test(message)) {
    return "Unauthorized";
  }
  if (/notebook not found/i.test(message)) {
    return "Notebook not found";
  }
  if (/already added|duplicate website|duplicate youtube|already added to the notebook/i.test(message)) {
    if (/youtube/i.test(message)) {
      return "This YouTube video is already added to the notebook.";
    }
    if (/website/i.test(message)) {
      return "This website is already added to the notebook.";
    }
    return message;
  }
  if (/invalid vtt|corrupted vtt|empty vtt/i.test(message)) {
    return message;
  }
  if (/invalid youtube url|unsupported youtube url/i.test(message)) {
    return message.includes("Unsupported")
      ? "Unsupported YouTube URL"
      : "Invalid YouTube URL";
  }
  if (/private or restricted youtube/i.test(message)) {
    return "Private or restricted YouTube video";
  }
  if (/youtube video not found|deleted/i.test(message)) {
    return "YouTube video not found or deleted";
  }
  if (/no transcript available/i.test(message)) {
    return "No transcript available for this video";
  }
  if (/youtube transcript fetch timed out/i.test(message)) {
    return "YouTube transcript fetch timed out";
  }
  if (/invalid SUPADATA_API_KEY/i.test(message)) {
    return "Invalid SUPADATA_API_KEY";
  }
  if (
    /blocked transcript access|too many requests|rate limited|SUPADATA_API_KEY/i.test(
      message
    )
  ) {
    return message.includes("SUPADATA_API_KEY")
      ? CLOUD_YOUTUBE_BLOCKED_MESSAGE
      : "YouTube temporarily blocked transcript access from this server. Try again shortly.";
  }
  if (/youtube transcript fetch failed/i.test(message)) {
    return message.startsWith("YouTube transcript fetch failed")
      ? message
      : "YouTube transcript fetch failed";
  }
  if (/invalid url/i.test(message)) {
    return message.includes("http")
      ? message
      : "Invalid URL. Only http and https are supported.";
  }
  if (/website fetch timed out|timed out/i.test(message)) {
    return /youtube/i.test(message)
      ? "YouTube transcript fetch timed out"
      : "Website fetch timed out";
  }
  if (/website unreachable|host is not allowed/i.test(message)) {
    return /HTTP \d+/.test(message) ? message : "Website unreachable";
  }
  if (/empty website content/i.test(message)) {
    return "Empty website content";
  }
  if (/unsupported content type/i.test(message)) {
    return message;
  }
  if (/website content is too large/i.test(message)) {
    return "Website content is too large";
  }
  if (/unsupported file type/i.test(message)) {
    return "Unsupported file type. Only PDF, plain text, and VTT subtitles are allowed.";
  }
  if (/too large|between 1 byte|file must be/i.test(message)) {
    return message.includes("MB")
      ? message
      : `File too large. Maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`;
  }
  if (
    /pdf parsing|no extractable text|no embeddable text|image-only pdf|corrupt/i.test(
      message
    )
  ) {
    if (/no extractable text|no embeddable text|image-only/i.test(message)) {
      return "PDF extraction failed: no embeddable text (image-only PDF).";
    }
    return "PDF parsing failed";
  }
  if (/embedding failed|embeddings missing|chunking produced/i.test(message)) {
    return message;
  }
  if (/storage error:/i.test(message)) {
    if (/not configured|BLOB_STORE_ID|BLOB_READ_WRITE_TOKEN/i.test(message)) {
      return "Storage error: Blob is not configured on this deployment.";
    }
    return "Storage error";
  }
  if (
    /BLOB_STORE_ID|BLOB_READ_WRITE_TOKEN|blob store|blob write|ENOENT|EACCES/i.test(
      message
    )
  ) {
    return "Storage error";
  }
  if (/prisma|database|P\d{4}/i.test(message)) {
    return "Database error";
  }

  // Never leak raw exception text (stack fragments, provider internals).
  return "Upload failed. Please try again.";
}

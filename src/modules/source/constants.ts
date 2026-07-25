import { MAX_UPLOAD_BYTES } from "@/modules/files/constants";

export { MAX_UPLOAD_BYTES };

/** Source library allows PDF and plain text only. */
export const SOURCE_ALLOWED_MEDIA_TYPES = [
  "application/pdf",
  "text/plain",
] as const;

export type SourceAllowedMediaType =
  (typeof SOURCE_ALLOWED_MEDIA_TYPES)[number];

export const SOURCE_TITLE_MAX_LENGTH = 100;

export function isSourceAllowedMediaType(
  value: string
): value is SourceAllowedMediaType {
  return (SOURCE_ALLOWED_MEDIA_TYPES as readonly string[]).includes(value);
}

export function sourceTypeFromMediaType(
  mediaType: SourceAllowedMediaType
): "PDF" | "TEXT" {
  return mediaType === "application/pdf" ? "PDF" : "TEXT";
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
 * Many browsers leave `file.type` empty (or octet-stream) for .txt/.pdf —
 * fall back to the filename extension so uploads are not rejected.
 */
export function resolveSourceMediaType(input: {
  filename: string;
  fileType?: string | null;
}): SourceAllowedMediaType | null {
  const declared = (input.fileType ?? "").trim().toLowerCase();
  if (isSourceAllowedMediaType(declared)) {
    return declared;
  }

  const lowerName = input.filename.trim().toLowerCase();
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
  if (/unsupported file type/i.test(message)) {
    return "Unsupported file type. Only PDF and plain text are allowed.";
  }
  if (/too large|between 1 byte|file must be/i.test(message)) {
    return message.includes("MB")
      ? message
      : `File too large. Maximum size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`;
  }
  if (/pdf parsing|no extractable text|corrupt/i.test(message)) {
    return /no extractable text/i.test(message)
      ? message
      : "PDF parsing failed";
  }
  if (/storage error:/i.test(message)) {
    return message;
  }
  if (/BLOB_STORE_ID|BLOB_READ_WRITE_TOKEN|blob store|ENOENT|EACCES/i.test(message)) {
    return message.startsWith("Storage error")
      ? message
      : `Storage error: ${message}`;
  }
  if (/prisma|database|P\d{4}/i.test(message)) {
    return "Database error";
  }

  return message;
}

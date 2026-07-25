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

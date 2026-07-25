/** Max upload size (bytes). Direct S3 upload bypasses Vercel’s 4.5MB API body limit. */
export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024; // 1GB

export const ALLOWED_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/csv",
] as const;

export type AllowedMediaType = (typeof ALLOWED_MEDIA_TYPES)[number];

export function isAllowedMediaType(value: string): value is AllowedMediaType {
  return (ALLOWED_MEDIA_TYPES as readonly string[]).includes(value);
}

export function isImageMediaType(mediaType: string) {
  return mediaType.startsWith("image/");
}

export function isExtractableMediaType(mediaType: string) {
  return (
    mediaType === "application/pdf" ||
    mediaType.startsWith("text/")
  );
}

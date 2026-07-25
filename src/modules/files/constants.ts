export {
  MAX_UPLOAD_BYTES,
  VERCEL_FUNCTION_BODY_LIMIT_BYTES,
  bytesToMb,
  formatUploadMb,
  evaluateUploadSize,
  requiresDirectUpload,
  uploadSizeErrorMessage,
} from "@/modules/files/upload-size";

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

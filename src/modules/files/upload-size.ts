/**
 * Single source of truth for user-upload size limits (sources + chat attachments).
 *
 * NOTE: Vercel Functions reject request bodies over ~4.5MB. That is a platform
 * proxy limit — NOT MAX_UPLOAD_BYTES. Files above VERCEL_FUNCTION_BODY_LIMIT_BYTES
 * must use browser→S3 direct upload. Never map a Vercel 413 to “exceeds MAX_UPLOAD”.
 *
 * This module is intentionally dependency-free so client components can import it
 * without pulling Node-only packages (@sentry/node via logger).
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MiB

/** Vercel Function request/response body ceiling (~4.5 MiB). */
export const VERCEL_FUNCTION_BODY_LIMIT_BYTES = Math.floor(4.5 * 1024 * 1024);

export function bytesToMb(bytes: number): number {
  return bytes / (1024 * 1024);
}

export function formatUploadMb(bytes: number): string {
  const mb = bytesToMb(bytes);
  if (mb >= 100) return `${Math.round(mb)}MB`;
  if (mb >= 10) return `${mb.toFixed(1)}MB`;
  return `${mb.toFixed(2)}MB`;
}

export type UploadSizeDecision = {
  ok: boolean;
  bytes: number;
  mb: number;
  maxBytes: number;
  maxMb: number;
  comparison: string;
  reason: string | null;
};

/**
 * Validate upload size against MAX_UPLOAD_BYTES.
 * Callers that need diagnostics should log the returned decision on the server.
 */
export function evaluateUploadSize(bytes: number): UploadSizeDecision {
  const mb = bytesToMb(bytes);
  const maxMb = bytesToMb(MAX_UPLOAD_BYTES);
  const empty = bytes <= 0;
  const tooLarge = bytes > MAX_UPLOAD_BYTES;
  const ok = !empty && !tooLarge;

  const comparison = empty
    ? `${bytes} <= 0`
    : `${bytes} ${tooLarge ? ">" : "<="} ${MAX_UPLOAD_BYTES}`;

  const reason = empty
    ? "empty_file"
    : tooLarge
      ? "exceeds_max_upload_bytes"
      : null;

  return {
    ok,
    bytes,
    mb,
    maxBytes: MAX_UPLOAD_BYTES,
    maxMb,
    comparison,
    reason,
  };
}

/** True when the file cannot safely travel through a Vercel Function body. */
export function requiresDirectUpload(bytes: number): boolean {
  return bytes > VERCEL_FUNCTION_BODY_LIMIT_BYTES;
}

export function uploadSizeErrorMessage(decision: UploadSizeDecision): string {
  if (decision.reason === "empty_file") {
    return "File is empty.";
  }
  return `File too large (${formatUploadMb(decision.bytes)}). Maximum size is ${formatUploadMb(decision.maxBytes)}.`;
}

/** Structured fields for server-side `[UPLOAD_SIZE] check` logs. */
export function uploadSizeLogFields(
  decision: UploadSizeDecision,
  context: string
): Record<string, unknown> {
  return {
    context,
    ...decision,
    fileSizeBytes: decision.bytes,
    fileSizeMb: Number(decision.mb.toFixed(4)),
    configuredMaxBytes: decision.maxBytes,
    configuredMaxMb: decision.maxMb,
    rejected: !decision.ok,
    rejectedReason: decision.reason,
    requiresDirectUpload: requiresDirectUpload(decision.bytes),
    vercelBodyLimitBytes: VERCEL_FUNCTION_BODY_LIMIT_BYTES,
  };
}

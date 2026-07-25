import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, get, put } from "@vercel/blob";
import type { AttachmentStorage } from "@/generated/prisma/client";
import { isAppError, storageError } from "@/lib/errors";
import {
  isS3Configured,
  s3DeleteObject,
  s3GetObject,
  s3GetObjectBytes,
  s3GetPutSignedUrl,
  s3GetSignedUrl,
  s3ObjectExists,
  s3PutObject,
} from "@/modules/files/s3";

const LOCAL_ROOT = path.join(process.cwd(), ".data", "uploads");

/**
 * Blob is available when either:
 * - BLOB_READ_WRITE_TOKEN (static token / local + client uploads), or
 * - BLOB_STORE_ID (OIDC on Vercel — preferred for Production)
 */
export function isVercelBlobConfigured() {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
      process.env.BLOB_STORE_ID?.trim()
  );
}

export function getLocalAttachmentDir(attachmentId: string) {
  return path.join(LOCAL_ROOT, attachmentId);
}

export function getLocalPagePath(attachmentId: string, page: number) {
  return path.join(LOCAL_ROOT, attachmentId, "pages", `${page}.png`);
}

export type StoredObject = {
  storage: AttachmentStorage;
  storageKey: string;
  /** Public or app-relative URL used in UIMessage file parts. */
  url: string;
};

export type StoredObjectBody = {
  stream: ReadableStream<Uint8Array>;
  contentType?: string;
  contentLength?: number;
};

function isVercelRuntime() {
  return process.env.VERCEL === "1";
}

function blobAuthOptions(): { token?: string } {
  const token = process.env.BLOB_READ_WRITE_TOKEN?.trim();
  // Only pass token when set. On Vercel, omitting it lets the SDK use OIDC + BLOB_STORE_ID.
  return token ? { token } : {};
}

/** True when `candidate` resolves strictly inside `root` (prevents path traversal). */
function isPathInsideRoot(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const relative = path.relative(resolvedRoot, resolved);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * Infer storage backend from a Source.storagePath (sources have no storage enum).
 * - https://… → Vercel Blob
 * - attachments/… or sources/… → S3
 * - otherwise → local disk key
 */
export function resolveStorageFromPath(
  storagePath: string
): AttachmentStorage {
  if (
    storagePath.startsWith("https://") ||
    storagePath.startsWith("http://")
  ) {
    return "VERCEL_BLOB";
  }
  if (
    storagePath.startsWith("attachments/") ||
    storagePath.startsWith("sources/")
  ) {
    return "S3";
  }
  return "LOCAL";
}

/**
 * Persist bytes to S3 when configured, else Vercel Blob, else local disk.
 * On Vercel without S3/Blob, local disk is ephemeral and must not be used.
 */
export function buildAttachmentStorageKey(
  attachmentId: string,
  filename: string
): string {
  return `attachments/${attachmentId}/${sanitizeFilename(filename)}`;
}

/** Presigned PUT for browser → S3 direct upload (when S3 is configured). */
export async function createDirectUploadUrl(input: {
  attachmentId: string;
  filename: string;
  mediaType: string;
}): Promise<{ storageKey: string; uploadUrl: string } | null> {
  if (!isS3Configured()) return null;

  const storageKey = buildAttachmentStorageKey(
    input.attachmentId,
    input.filename
  );
  const uploadUrl = await s3GetPutSignedUrl({
    key: storageKey,
    contentType: input.mediaType,
  });
  return { storageKey, uploadUrl };
}

export async function storeUpload(input: {
  attachmentId: string;
  filename: string;
  mediaType: string;
  bytes: Buffer;
}): Promise<StoredObject> {
  const safeName = sanitizeFilename(input.filename);

  if (isS3Configured()) {
    try {
      const key = buildAttachmentStorageKey(input.attachmentId, input.filename);
      await s3PutObject({
        key,
        body: input.bytes,
        contentType: input.mediaType,
      });
      return {
        storage: "S3",
        storageKey: key,
        // Serve through authenticated API — objects stay private in S3.
        url: `/api/files/${input.attachmentId}`,
      };
    } catch (error) {
      if (isAppError(error)) throw error;
      const message =
        error instanceof Error ? error.message : "Unknown S3 error";
      throw storageError(`Storage error: ${message}`);
    }
  }

  if (isVercelBlobConfigured()) {
    try {
      const blob = await put(
        `attachments/${input.attachmentId}/${safeName}`,
        input.bytes,
        {
          // Store is private (Vercel Blob default for new stores).
          access: "private",
          contentType: input.mediaType,
          ...blobAuthOptions(),
        }
      );

      return {
        storage: "VERCEL_BLOB",
        storageKey: blob.url,
        // Serve through our authenticated API — private blob URLs are not
        // browser-accessible without a signed token.
        url: `/api/files/${input.attachmentId}`,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown blob error";
      throw storageError(
        `Storage error: ${message}. Check Blob store connection (BLOB_STORE_ID / BLOB_READ_WRITE_TOKEN).`
      );
    }
  }

  if (isVercelRuntime()) {
    throw storageError(
      "Storage error: Cloud storage is not configured. Set AWS_S3_BUCKET (+ AWS credentials) or connect Vercel Blob (BLOB_STORE_ID / BLOB_READ_WRITE_TOKEN)."
    );
  }

  await mkdir(LOCAL_ROOT, { recursive: true });
  const relativeKey = `${input.attachmentId}/${safeName}`;
  const absolute = path.join(LOCAL_ROOT, relativeKey);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, input.bytes);

  return {
    storage: "LOCAL",
    storageKey: relativeKey,
    url: `/api/files/${input.attachmentId}`,
  };
}

export async function readLocalUpload(storageKey: string): Promise<Buffer> {
  const absolute = path.join(LOCAL_ROOT, storageKey);
  if (!isPathInsideRoot(LOCAL_ROOT, absolute)) {
    throw storageError("Invalid storage key");
  }
  return readFile(path.resolve(absolute));
}

/**
 * Stream a private Vercel Blob object through the app (auth already checked).
 * Never 302-redirect to private blob URLs — browsers cannot fetch them.
 */
export async function readBlobUpload(storageKey: string): Promise<{
  stream: ReadableStream<Uint8Array>;
  contentType?: string;
}> {
  const result = await get(storageKey, {
    access: "private",
    ...blobAuthOptions(),
  });

  if (!result || result.statusCode !== 200 || !result.stream) {
    throw storageError("Storage error: Object not found");
  }

  return {
    stream: result.stream,
    contentType: result.blob.contentType,
  };
}

/** Stream a stored object from S3, Blob, or local disk. */
export async function readStoredUpload(input: {
  storage: AttachmentStorage;
  storageKey: string;
}): Promise<StoredObjectBody> {
  if (input.storage === "S3") {
    return s3GetObject(input.storageKey);
  }

  if (input.storage === "VERCEL_BLOB") {
    const blob = await readBlobUpload(input.storageKey);
    return { stream: blob.stream, contentType: blob.contentType };
  }

  const bytes = await readLocalUpload(input.storageKey);
  return {
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    }),
    contentType: undefined,
    contentLength: bytes.length,
  };
}

/** Buffer a stored object (small files / model prep). */
export async function readStoredUploadBytes(input: {
  storage: AttachmentStorage;
  storageKey: string;
}): Promise<Buffer> {
  if (input.storage === "S3") {
    return s3GetObjectBytes(input.storageKey);
  }
  if (input.storage === "VERCEL_BLOB") {
    const blob = await readBlobUpload(input.storageKey);
    const reader = blob.stream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c)));
  }
  return readLocalUpload(input.storageKey);
}

export async function storedObjectExists(input: {
  storage: AttachmentStorage;
  storageKey: string;
}): Promise<boolean> {
  if (input.storage === "S3") {
    return s3ObjectExists(input.storageKey);
  }
  if (input.storage === "VERCEL_BLOB") {
    try {
      await readBlobUpload(input.storageKey);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await readLocalUpload(input.storageKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Time-limited GET URL for private cloud objects.
 * Prefer streaming through /api/files for authz; signed URLs are opt-in.
 */
export async function getStoredObjectSignedUrl(input: {
  storage: AttachmentStorage;
  storageKey: string;
  expiresInSeconds?: number;
}): Promise<string | null> {
  if (input.storage === "S3") {
    return s3GetSignedUrl(input.storageKey, input.expiresInSeconds ?? 300);
  }
  // Private Blob / local have no generic signed URL in this layer.
  return null;
}

/**
 * Removes a stored upload (local directory, Vercel Blob URL, or S3 object).
 * Used by notebook sources; safe to call for attachment ids too.
 */
export async function deleteStoredUpload(input: {
  objectId: string;
  storage: AttachmentStorage;
  storageKey: string;
}): Promise<void> {
  if (input.storage === "S3") {
    try {
      await s3DeleteObject(input.storageKey);
    } catch {
      // Object may already be gone; continue.
    }
    return;
  }

  if (input.storage === "VERCEL_BLOB") {
    if (!isVercelBlobConfigured()) return;
    try {
      await del(input.storageKey, {
        ...blobAuthOptions(),
      });
    } catch {
      // Blob may already be gone; continue.
    }
    return;
  }

  const dir = getLocalAttachmentDir(input.objectId);
  if (!isPathInsideRoot(LOCAL_ROOT, dir)) {
    throw storageError("Invalid storage key");
  }

  await rm(path.resolve(dir), { recursive: true, force: true });
}

function sanitizeFilename(filename: string) {
  const base = path.basename(filename).replace(/[^\w.\- ()[\]]+/g, "_");
  return base.slice(0, 180) || "file";
}

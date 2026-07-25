import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { del, get, put } from "@vercel/blob";
import type { AttachmentStorage } from "@/generated/prisma/client";

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
 * Persist bytes to Vercel Blob when configured, otherwise local .data/uploads.
 * On Vercel, Blob is required — local disk is ephemeral and must not be used.
 */
export async function storeUpload(input: {
  attachmentId: string;
  filename: string;
  mediaType: string;
  bytes: Buffer;
}): Promise<StoredObject> {
  const safeName = sanitizeFilename(input.filename);

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
      throw new Error(
        `Storage error: ${message}. Check Blob store connection (BLOB_STORE_ID / BLOB_READ_WRITE_TOKEN).`
      );
    }
  }

  if (isVercelRuntime()) {
    throw new Error(
      "Storage error: Blob is not configured on this deployment. Connect a Vercel Blob store to the project (adds BLOB_STORE_ID) or set BLOB_READ_WRITE_TOKEN."
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
    throw new Error("Invalid storage key");
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
    throw new Error("Blob not found");
  }

  return {
    stream: result.stream,
    contentType: result.blob.contentType,
  };
}

/**
 * Removes a stored upload (local directory or Vercel Blob URL).
 * Used by notebook sources; safe to call for attachment ids too.
 */
export async function deleteStoredUpload(input: {
  objectId: string;
  storage: AttachmentStorage;
  storageKey: string;
}): Promise<void> {
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
    throw new Error("Invalid storage key");
  }

  await rm(path.resolve(dir), { recursive: true, force: true });
}

function sanitizeFilename(filename: string) {
  const base = path.basename(filename).replace(/[^\w.\- ()[\]]+/g, "_");
  return base.slice(0, 180) || "file";
}

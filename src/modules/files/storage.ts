import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { put } from "@vercel/blob";
import type { AttachmentStorage } from "@/generated/prisma/client";

const LOCAL_ROOT = path.join(process.cwd(), ".data", "uploads");

export function isVercelBlobConfigured() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
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
  if (isVercelBlobConfigured()) {
    const blob = await put(
      `attachments/${input.attachmentId}/${input.filename}`,
      input.bytes,
      {
        access: "public",
        contentType: input.mediaType,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      }
    );

    return {
      storage: "VERCEL_BLOB",
      storageKey: blob.url,
      url: blob.url,
    };
  }

  if (isVercelRuntime()) {
    throw new Error(
      "BLOB_READ_WRITE_TOKEN is required for uploads on Vercel. Local disk storage is not available in serverless."
    );
  }

  await mkdir(LOCAL_ROOT, { recursive: true });
  const relativeKey = `${input.attachmentId}/${sanitizeFilename(input.filename)}`;
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
  const resolved = path.resolve(absolute);
  if (!resolved.startsWith(path.resolve(LOCAL_ROOT))) {
    throw new Error("Invalid storage key");
  }
  return readFile(resolved);
}

function sanitizeFilename(filename: string) {
  const base = path.basename(filename).replace(/[^\w.\- ()[\]]+/g, "_");
  return base.slice(0, 180) || "file";
}

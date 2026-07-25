import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { isAppError, storageError } from "@/lib/errors";

export type S3ObjectBody = {
  stream: ReadableStream<Uint8Array>;
  contentType?: string;
  contentLength?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SendableClient = { send: (command: any) => Promise<any> };

let clientOverride: SendableClient | null = null;

/** Test helper — inject a mock S3 client. */
export function setS3ClientForTests(client: SendableClient | null) {
  clientOverride = client;
}

export function isS3Configured(): boolean {
  return getS3ConfigStatus().configured;
}

/**
 * Which AWS env vars are present (booleans only — never log secret values).
 * Used to explain DIRECT_UPLOAD_UNAVAILABLE without guessing.
 */
export function getS3ConfigStatus(): {
  configured: boolean;
  present: string[];
  missing: string[];
} {
  const required = [
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_S3_BUCKET",
  ] as const;

  const present: string[] = [];
  const missing: string[] = [];
  for (const key of required) {
    if (process.env[key]?.trim()) present.push(key);
    else missing.push(key);
  }

  return {
    configured: missing.length === 0,
    present,
    missing,
  };
}

export function getS3Bucket(): string {
  const bucket = process.env.AWS_S3_BUCKET?.trim();
  if (!bucket) {
    throw storageError("Storage error: AWS_S3_BUCKET is not configured.");
  }
  return bucket;
}

function getS3Client(): SendableClient {
  if (clientOverride) return clientOverride;

  const region = process.env.AWS_REGION?.trim();
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY?.trim();

  if (!region || !accessKeyId || !secretAccessKey) {
    throw storageError(
      "Storage error: AWS credentials are not configured (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)."
    );
  }

  const config: S3ClientConfig = {
    region,
    credentials: { accessKeyId, secretAccessKey },
    // Browser PUT via presigned URL cannot satisfy SDK-default flexible
    // checksums (x-amz-checksum-* hoisted into the query string).
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  };

  return new S3Client(config);
}

function toStorageError(error: unknown, fallback: string): never {
  if (isAppError(error)) throw error;

  const message =
    error instanceof Error ? error.message : "Unknown S3 error";
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: string }).name ?? "")
      : "";

  if (
    name === "NoSuchKey" ||
    name === "NotFound" ||
    /NotFound|NoSuchKey|404/i.test(message)
  ) {
    throw storageError("Storage error: Object not found");
  }

  throw storageError(`${fallback}: ${message}`);
}

/**
 * Upload bytes to a private S3 object.
 * Body is already buffered by the upload API; PutObject accepts Buffer.
 */
export async function s3PutObject(input: {
  key: string;
  body: Buffer;
  contentType: string;
}): Promise<{ key: string }> {
  try {
    const client = getS3Client();
    await client.send(
      new PutObjectCommand({
        Bucket: getS3Bucket(),
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType,
        // Bucket policy / ACLs keep objects private; block public ACLs.
        ACL: undefined,
      })
    );
    return { key: input.key };
  } catch (error) {
    toStorageError(error, "Storage error: S3 upload failed");
  }
}

/** Stream a private S3 object (does not buffer the full body). */
export async function s3GetObject(key: string): Promise<S3ObjectBody> {
  try {
    const client = getS3Client();
    const result = (await client.send(
      new GetObjectCommand({
        Bucket: getS3Bucket(),
        Key: key,
      })
    )) as {
      Body?: {
        transformToWebStream?: () => ReadableStream<Uint8Array>;
      };
      ContentType?: string;
      ContentLength?: number;
    };

    const body = result.Body;
    if (!body?.transformToWebStream) {
      throw storageError("Storage error: Object not found");
    }

    return {
      stream: body.transformToWebStream(),
      contentType: result.ContentType,
      contentLength:
        typeof result.ContentLength === "number"
          ? result.ContentLength
          : undefined,
    };
  } catch (error) {
    toStorageError(error, "Storage error: S3 download failed");
  }
}

/** Buffer a private S3 object (for small assets / model prep). */
export async function s3GetObjectBytes(key: string): Promise<Buffer> {
  try {
    const client = getS3Client();
    const result = (await client.send(
      new GetObjectCommand({
        Bucket: getS3Bucket(),
        Key: key,
      })
    )) as {
      Body?: {
        transformToByteArray?: () => Promise<Uint8Array>;
      };
    };

    if (!result.Body?.transformToByteArray) {
      throw storageError("Storage error: Object not found");
    }

    const bytes = await result.Body.transformToByteArray();
    return Buffer.from(bytes);
  } catch (error) {
    toStorageError(error, "Storage error: S3 download failed");
  }
}

export async function s3DeleteObject(key: string): Promise<void> {
  try {
    const client = getS3Client();
    await client.send(
      new DeleteObjectCommand({
        Bucket: getS3Bucket(),
        Key: key,
      })
    );
  } catch (error) {
    toStorageError(error, "Storage error: S3 delete failed");
  }
}

export async function s3ObjectExists(key: string): Promise<boolean> {
  try {
    const client = getS3Client();
    await client.send(
      new HeadObjectCommand({
        Bucket: getS3Bucket(),
        Key: key,
      })
    );
    return true;
  } catch (error) {
    const name =
      error && typeof error === "object" && "name" in error
        ? String((error as { name?: string }).name ?? "")
        : "";
    const status =
      error && typeof error === "object" && "$metadata" in error
        ? Number(
            (error as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode ?? 0
          )
        : 0;
    if (name === "NotFound" || name === "NoSuchKey" || status === 404) {
      return false;
    }
    toStorageError(error, "Storage error: S3 head failed");
  }
}

/** Time-limited GET URL for private objects (short TTL). */
export async function s3GetSignedUrl(
  key: string,
  expiresInSeconds = 300
): Promise<string> {
  try {
    const client = getS3Client();
    // Presigner requires a real S3Client instance.
    if (clientOverride && !(client instanceof S3Client)) {
      throw storageError(
        "Storage error: Signed URLs require a real S3 client"
      );
    }
    return await getSignedUrl(
      client as S3Client,
      new GetObjectCommand({
        Bucket: getS3Bucket(),
        Key: key,
      }),
      { expiresIn: expiresInSeconds }
    );
  } catch (error) {
    toStorageError(error, "Storage error: S3 signed URL failed");
  }
}

/**
 * Time-limited PUT URL so the browser can upload directly to S3
 * (bypasses the Vercel Function 4.5MB request body limit).
 */
export async function s3GetPutSignedUrl(input: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<string> {
  try {
    const client = getS3Client();
    if (clientOverride && !(client instanceof S3Client)) {
      throw storageError(
        "Storage error: Signed URLs require a real S3 client"
      );
    }
    return await getSignedUrl(
      client as S3Client,
      new PutObjectCommand({
        Bucket: getS3Bucket(),
        Key: input.key,
        ContentType: input.contentType,
      }),
      {
        expiresIn: input.expiresInSeconds ?? 900,
        // Keep checksum headers out of the query string for browser PUTs.
        unhoistableHeaders: new Set([
          "x-amz-checksum-crc32",
          "x-amz-checksum-crc32c",
          "x-amz-checksum-sha1",
          "x-amz-checksum-sha256",
          "x-amz-sdk-checksum-algorithm",
        ]),
      }
    );
  } catch (error) {
    toStorageError(error, "Storage error: S3 upload URL failed");
  }
}

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { isAppError } from "@/lib/errors";
import {
  setS3ClientForTests,
  s3GetObject,
  s3GetObjectBytes,
  s3ObjectExists,
  s3PutObject,
} from "@/modules/files/s3";
import {
  buildAttachmentPageStorageKey,
  deleteStoredUpload,
  resolveStorageFromPath,
  storedObjectExists,
  storeUpload,
} from "@/modules/files/storage";

type MockCall = { name: string; input: Record<string, unknown> };

function mockS3(options?: {
  failPut?: boolean;
  failGet?: boolean;
  missing?: boolean;
  objects?: Map<string, { body: Buffer; contentType: string }>;
}) {
  const objects =
    options?.objects ??
    new Map<string, { body: Buffer; contentType: string }>();
  const calls: MockCall[] = [];

  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      const name = command.constructor.name;
      calls.push({ name, input: command.input });

      if (name === "PutObjectCommand") {
        if (options?.failPut) {
          const err = new Error("AccessDenied");
          err.name = "AccessDenied";
          throw err;
        }
        const key = String(command.input.Key);
        const body = command.input.Body as Buffer;
        objects.set(key, {
          body: Buffer.from(body),
          contentType: String(command.input.ContentType ?? "application/octet-stream"),
        });
        return {};
      }

      if (name === "GetObjectCommand") {
        if (options?.failGet) {
          const err = new Error("InternalError");
          err.name = "InternalError";
          throw err;
        }
        const key = String(command.input.Key);
        const hit = objects.get(key);
        if (!hit || options?.missing) {
          const err = new Error("The specified key does not exist.");
          err.name = "NoSuchKey";
          throw err;
        }
        return {
          ContentType: hit.contentType,
          ContentLength: hit.body.length,
          Body: {
            transformToWebStream() {
              return new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(new Uint8Array(hit.body));
                  controller.close();
                },
              });
            },
            async transformToByteArray() {
              return new Uint8Array(hit.body);
            },
          },
        };
      }

      if (name === "HeadObjectCommand") {
        const key = String(command.input.Key);
        if (!objects.has(key) || options?.missing) {
          const err = new Error("Not Found");
          err.name = "NotFound";
          (err as { $metadata?: { httpStatusCode: number } }).$metadata = {
            httpStatusCode: 404,
          };
          throw err;
        }
        return {};
      }

      if (name === "DeleteObjectCommand") {
        objects.delete(String(command.input.Key));
        return {};
      }

      if (name === "ListObjectsV2Command") {
        const prefix = String(command.input.Prefix ?? "");
        return {
          Contents: [...objects.keys()]
            .filter((key) => key.startsWith(prefix))
            .map((Key) => ({ Key })),
          IsTruncated: false,
        };
      }

      throw new Error(`Unexpected command ${name}`);
    },
  };

  return { client, objects, calls };
}

describe("resolveStorageFromPath", () => {
  it("maps blob URLs, S3 keys, and local keys", () => {
    assert.equal(
      resolveStorageFromPath("https://blob.vercel-storage.com/x"),
      "VERCEL_BLOB"
    );
    assert.equal(
      resolveStorageFromPath("attachments/abc/file.pdf"),
      "S3"
    );
    assert.equal(resolveStorageFromPath("sources/abc/notes.vtt"), "S3");
    assert.equal(resolveStorageFromPath("abc/file.pdf"), "LOCAL");
  });
});

describe("S3 storage layer", () => {
  const prev = {
    region: process.env.AWS_REGION,
    key: process.env.AWS_ACCESS_KEY_ID,
    secret: process.env.AWS_SECRET_ACCESS_KEY,
    bucket: process.env.AWS_S3_BUCKET,
    blob: process.env.BLOB_READ_WRITE_TOKEN,
    store: process.env.BLOB_STORE_ID,
  };

  afterEach(() => {
    setS3ClientForTests(null);
    process.env.AWS_REGION = prev.region;
    process.env.AWS_ACCESS_KEY_ID = prev.key;
    process.env.AWS_SECRET_ACCESS_KEY = prev.secret;
    process.env.AWS_S3_BUCKET = prev.bucket;
    process.env.BLOB_READ_WRITE_TOKEN = prev.blob;
    process.env.BLOB_STORE_ID = prev.store;
  });

  function enableS3Env() {
    process.env.AWS_REGION = "ap-southeast-1";
    process.env.AWS_ACCESS_KEY_ID = "test";
    process.env.AWS_SECRET_ACCESS_KEY = "test";
    process.env.AWS_S3_BUCKET = "siro-test-bucket";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_STORE_ID;
  }

  it("uploads a PDF to S3 and returns a private API URL", async () => {
    enableS3Env();
    const { client, objects } = mockS3();
    setS3ClientForTests(client);

    const stored = await storeUpload({
      attachmentId: "att_pdf",
      filename: "report.pdf",
      mediaType: "application/pdf",
      bytes: Buffer.from("%PDF-1.4 mock"),
    });

    assert.equal(stored.storage, "S3");
    assert.equal(stored.storageKey, "attachments/att_pdf/report.pdf");
    assert.equal(stored.url, "/api/files/att_pdf");
    assert.equal(objects.has(stored.storageKey), true);
  });

  it("uploads a VTT file to S3", async () => {
    enableS3Env();
    const { client, objects } = mockS3();
    setS3ClientForTests(client);

    const stored = await storeUpload({
      attachmentId: "att_vtt",
      filename: "captions.vtt",
      mediaType: "text/vtt",
      bytes: Buffer.from("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHi"),
    });

    assert.equal(stored.storage, "S3");
    assert.match(stored.storageKey, /\.vtt$/);
    assert.equal(objects.has(stored.storageKey), true);
  });

  it("downloads streamed bytes from S3", async () => {
    enableS3Env();
    const { client } = mockS3();
    setS3ClientForTests(client);
    await s3PutObject({
      key: "attachments/a/file.txt",
      body: Buffer.from("hello-s3"),
      contentType: "text/plain",
    });

    const object = await s3GetObject("attachments/a/file.txt");
    const reader = object.stream.getReader();
    const { value } = await reader.read();
    assert.equal(Buffer.from(value!).toString("utf8"), "hello-s3");

    const bytes = await s3GetObjectBytes("attachments/a/file.txt");
    assert.equal(bytes.toString("utf8"), "hello-s3");
  });

  it("deletes an S3 object", async () => {
    enableS3Env();
    const { client, objects } = mockS3();
    setS3ClientForTests(client);
    await s3PutObject({
      key: "attachments/del/x.pdf",
      body: Buffer.from("x"),
      contentType: "application/pdf",
    });
    assert.equal(objects.has("attachments/del/x.pdf"), true);

    await deleteStoredUpload({
      objectId: "del",
      storage: "S3",
      storageKey: "attachments/del/x.pdf",
    });
    assert.equal(objects.has("attachments/del/x.pdf"), false);
  });

  it("deletes rendered PDF page images along with the file", async () => {
    enableS3Env();
    const { client, objects } = mockS3();
    setS3ClientForTests(client);

    await s3PutObject({
      key: "attachments/pages/doc.pdf",
      body: Buffer.from("pdf"),
      contentType: "application/pdf",
    });
    await s3PutObject({
      key: buildAttachmentPageStorageKey("pages", 1),
      body: Buffer.from("png-1"),
      contentType: "image/png",
    });
    await s3PutObject({
      key: buildAttachmentPageStorageKey("pages", 2),
      body: Buffer.from("png-2"),
      contentType: "image/png",
    });
    assert.equal(objects.size, 3);

    await deleteStoredUpload({
      objectId: "pages",
      storage: "S3",
      storageKey: "attachments/pages/doc.pdf",
    });

    assert.equal(objects.size, 0);
  });

  it("keys page images beside the source file", () => {
    assert.equal(
      buildAttachmentPageStorageKey("abc", 3),
      "attachments/abc/pages/3.png"
    );
    assert.equal(resolveStorageFromPath("attachments/abc/pages/3.png"), "S3");
  });

  it("reports missing objects via exists + typed download error", async () => {
    enableS3Env();
    const { client } = mockS3();
    setS3ClientForTests(client);

    assert.equal(await s3ObjectExists("attachments/missing/file.pdf"), false);
    assert.equal(
      await storedObjectExists({
        storage: "S3",
        storageKey: "attachments/missing/file.pdf",
      }),
      false
    );

    await assert.rejects(
      () => s3GetObject("attachments/missing/file.pdf"),
      (error: unknown) => {
        assert.equal(isAppError(error), true);
        assert.match(String((error as Error).message), /not found/i);
        return true;
      }
    );
  });

  it("surfaces typed errors on S3 upload failure", async () => {
    enableS3Env();
    const { client } = mockS3({ failPut: true });
    setS3ClientForTests(client);

    await assert.rejects(
      () =>
        storeUpload({
          attachmentId: "att_fail",
          filename: "a.pdf",
          mediaType: "application/pdf",
          bytes: Buffer.from("x"),
        }),
      (error: unknown) => {
        assert.equal(isAppError(error), true);
        assert.match(String((error as Error).message), /Storage error/i);
        return true;
      }
    );
  });

  it("surfaces typed errors on S3 download failure", async () => {
    enableS3Env();
    const { client } = mockS3({ failGet: true });
    setS3ClientForTests(client);
    // Seed bypassing get failure path for put... put still works
    const putClient = mockS3();
    setS3ClientForTests(putClient.client);
    await s3PutObject({
      key: "attachments/x/y.pdf",
      body: Buffer.from("y"),
      contentType: "application/pdf",
    });
    // Re-bind failGet client that shares no objects → NoSuchKey OR use failGet with same objects
    const fail = mockS3({
      failGet: true,
      objects: putClient.objects,
    });
    setS3ClientForTests(fail.client);

    await assert.rejects(
      () => s3GetObjectBytes("attachments/x/y.pdf"),
      (error: unknown) => {
        assert.equal(isAppError(error), true);
        assert.match(String((error as Error).message), /Storage error/i);
        return true;
      }
    );
  });

  it("delete is a no-op when the S3 object is already gone", async () => {
    enableS3Env();
    const { client } = mockS3();
    setS3ClientForTests(client);
    await deleteStoredUpload({
      objectId: "gone",
      storage: "S3",
      storageKey: "attachments/gone/file.pdf",
    });
  });
});

describe("storage authz contract (routes keep ownership checks)", () => {
  it("keeps file URLs on the authenticated /api/files proxy", async () => {
    process.env.AWS_REGION = "ap-southeast-1";
    process.env.AWS_ACCESS_KEY_ID = "test";
    process.env.AWS_SECRET_ACCESS_KEY = "test";
    process.env.AWS_S3_BUCKET = "siro-test-bucket";
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_STORE_ID;

    const { client } = mockS3();
    setS3ClientForTests(client);

    const stored = await storeUpload({
      attachmentId: "owned_only",
      filename: "secret.pdf",
      mediaType: "application/pdf",
      bytes: Buffer.from("secret"),
    });

    // Storage never returns a public S3 URL — callers must authorize via API.
    assert.equal(stored.url.startsWith("/api/files/"), true);
    assert.equal(stored.url.includes("amazonaws.com"), false);

    setS3ClientForTests(null);
  });
});

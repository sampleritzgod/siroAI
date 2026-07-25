import "@/modules/notebook/load-test-env";

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { GET as healthGet } from "@/app/api/health/route";
import { GET as readyGet } from "@/app/api/ready/route";
import { GET as metricsGet } from "@/app/api/metrics/route";
import { GET as cronGet } from "@/app/api/cron/jobs/route";
import { POST as sourcesPost } from "@/app/api/sources/route";
import { POST as filesPost } from "@/app/api/files/route";
import { prisma } from "@/lib/db";
import {
  enqueueJob,
  indexSourceIdempotencyKey,
  getJobStats,
} from "@/modules/jobs/queue";
import { processJobs } from "@/modules/jobs/worker";
import { createNotebookForUser } from "@/modules/notebook/service";

const hasDatabase = Boolean(process.env.DATABASE_URL?.trim());

describe("API routes — health / ready / auth gates", () => {
  it("GET /api/health returns alive 200", async () => {
    const res = await healthGet();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.status, "alive");
  });

  it("GET /api/ready returns dependency checks", async () => {
    const res = await readyGet();
    const body = await res.json();
    assert.ok(typeof body.ok === "boolean");
    assert.ok(body.checks);
    assert.ok(body.checks.database);
  });

  it("GET /api/metrics rejects without cron secret in production-like setup", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-cron-secret";
    try {
      const res = await metricsGet(
        new Request("http://localhost/api/metrics")
      );
      assert.equal(res.status, 401);
      const body = await res.json();
      assert.equal(body.code, "UNAUTHORIZED");
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });

  it("GET /api/cron/jobs accepts bearer secret", async () => {
    const prev = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-cron-secret";
    try {
      const res = await cronGet(
        new Request("http://localhost/api/cron/jobs", {
          headers: { Authorization: "Bearer test-cron-secret" },
        })
      );
      // May 200 if DB up, or 500 if migrate missing — must not be 401.
      assert.notEqual(res.status, 401);
    } finally {
      if (prev === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = prev;
    }
  });
});

describe("API routes — sources/files unauthorized", () => {
  it("POST /api/sources without auth → 401", async () => {
    const res = await sourcesPost(
      new Request("http://localhost/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebookId: "x", url: "https://example.com" }),
      })
    );
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.code, "UNAUTHORIZED");
  });

  it("POST /api/files without auth → 401", async () => {
    const res = await filesPost(
      new Request("http://localhost/api/files", {
        method: "POST",
        body: new FormData(),
      })
    );
    assert.equal(res.status, 401);
  });
});

describe(
  "durable job queue",
  { skip: !hasDatabase },
  () => {
    let userId = "";
    let notebookId = "";

    before(async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const user = await prisma.user.create({
        data: {
          clerkId: `job_${suffix}`,
          email: `job-${suffix}@example.com`,
        },
      });
      userId = user.id;
      notebookId = (
        await createNotebookForUser({ userId, title: "Jobs" })
      ).id;
    });

    after(async () => {
      if (userId) {
        await prisma.user.delete({ where: { id: userId } }).catch(() => {});
      }
    });

    it("enqueue is idempotent by key", async () => {
      const source = await prisma.source.create({
        data: {
          notebookId,
          type: "TEXT",
          title: "Job Source",
          originalFileName: "j.txt",
          mimeType: "text/plain",
          fileSize: 10,
          storagePath: "pending",
          extractedText: "hello world job queue indexing text content here",
          indexingStatus: "PENDING",
        },
      });

      const key = indexSourceIdempotencyKey(source.id);
      const a = await enqueueJob({
        type: "INDEX_SOURCE",
        idempotencyKey: key,
        payload: { sourceId: source.id, notebookId },
      });
      const b = await enqueueJob({
        type: "INDEX_SOURCE",
        idempotencyKey: key,
        payload: { sourceId: source.id, notebookId },
      });
      assert.equal(a.id, b.id);
      assert.equal(a.status, "PENDING");
    });

    it("processJobs reports stats shape", async () => {
      const result = await processJobs({ limit: 1 });
      assert.ok(typeof result.processed === "number");
      const stats = await getJobStats();
      assert.ok("PENDING" in stats);
      assert.ok("DEAD" in stats);
    });
  }
);

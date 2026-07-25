import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MAX_UPLOAD_BYTES,
  VERCEL_FUNCTION_BODY_LIMIT_BYTES,
  bytesToMb,
  evaluateUploadSize,
  requiresDirectUpload,
} from "@/modules/files/upload-size";

function mb(n: number): number {
  return Math.round(n * 1024 * 1024);
}

describe("upload size — single source of truth", () => {
  it("uses 10 MiB as MAX_UPLOAD_BYTES", () => {
    assert.equal(MAX_UPLOAD_BYTES, 10 * 1024 * 1024);
    assert.equal(MAX_UPLOAD_BYTES, 10_485_760);
  });

  it("converts bytes to MB with 1024-based MiB", () => {
    assert.equal(bytesToMb(0), 0);
    assert.equal(bytesToMb(1024 * 1024), 1);
    assert.equal(bytesToMb(6 * 1024 * 1024), 6);
    assert.equal(bytesToMb(MAX_UPLOAD_BYTES), 10);
  });

  it("documents Vercel body limit below app max", () => {
    assert.ok(VERCEL_FUNCTION_BODY_LIMIT_BYTES < MAX_UPLOAD_BYTES);
    assert.equal(VERCEL_FUNCTION_BODY_LIMIT_BYTES, Math.floor(4.5 * 1024 * 1024));
  });
});

describe("evaluateUploadSize boundaries", () => {
  const cases: Array<{ label: string; bytes: number; expectOk: boolean }> = [
    { label: "1 MB", bytes: mb(1), expectOk: true },
    { label: "5 MB", bytes: mb(5), expectOk: true },
    { label: "6 MB", bytes: mb(6), expectOk: true },
    { label: "9.9 MB", bytes: mb(9.9), expectOk: true },
    { label: "10 MB exact", bytes: mb(10), expectOk: true },
    { label: "10.1 MB", bytes: mb(10.1), expectOk: false },
    { label: "20 MB", bytes: mb(20), expectOk: false },
  ];

  for (const { label, bytes, expectOk } of cases) {
    it(`${label} (${bytes} bytes) => ok=${expectOk}`, () => {
      const decision = evaluateUploadSize(bytes, `test:${label}`);
      assert.equal(decision.ok, expectOk, decision.comparison);
      assert.equal(decision.bytes, bytes);
      assert.equal(decision.maxBytes, MAX_UPLOAD_BYTES);
      if (expectOk) {
        assert.equal(decision.reason, null);
        assert.ok(bytes <= MAX_UPLOAD_BYTES);
      } else {
        assert.equal(decision.reason, "exceeds_max_upload_bytes");
        assert.ok(bytes > MAX_UPLOAD_BYTES);
      }
    });
  }

  it("rejects empty files", () => {
    const decision = evaluateUploadSize(0, "test:empty");
    assert.equal(decision.ok, false);
    assert.equal(decision.reason, "empty_file");
  });

  it("6 MB requires direct upload on Vercel but passes app max", () => {
    const sixMb = mb(6);
    assert.equal(evaluateUploadSize(sixMb, "test:6mb").ok, true);
    assert.equal(requiresDirectUpload(sixMb), true);
    assert.equal(requiresDirectUpload(mb(4)), false);
  });

  it("real bigGientchess.pdf size (~5.75 MiB) passes app max", () => {
    const realPdfBytes = 6_033_367;
    const decision = evaluateUploadSize(realPdfBytes, "test:bigGientchess");
    assert.equal(decision.ok, true);
    assert.ok(realPdfBytes < MAX_UPLOAD_BYTES);
    assert.equal(requiresDirectUpload(realPdfBytes), true);
  });
});

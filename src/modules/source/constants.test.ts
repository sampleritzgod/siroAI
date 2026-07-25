import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultTitleFromFilename,
  formatSourceUploadError,
  isRemoteStoragePath,
  isSentinelStoragePath,
  isSourceAllowedMediaType,
  resolveSourceMediaType,
  sourceTypeFromMediaType,
} from "@/modules/source/constants";

describe("source constants", () => {
  it("allows only PDF, plain text, and VTT", () => {
    assert.equal(isSourceAllowedMediaType("application/pdf"), true);
    assert.equal(isSourceAllowedMediaType("text/plain"), true);
    assert.equal(isSourceAllowedMediaType("text/vtt"), true);
    assert.equal(isSourceAllowedMediaType("text/markdown"), false);
    assert.equal(isSourceAllowedMediaType("image/png"), false);
  });

  it("maps media types to source types", () => {
    assert.equal(sourceTypeFromMediaType("application/pdf"), "PDF");
    assert.equal(sourceTypeFromMediaType("text/plain"), "TEXT");
    assert.equal(sourceTypeFromMediaType("text/vtt"), "VTT");
  });

  it("derives titles from filenames", () => {
    assert.equal(defaultTitleFromFilename("Deep Learning.pdf"), "Deep Learning");
    assert.equal(defaultTitleFromFilename("notes.txt"), "notes");
  });

  it("detects remote storage paths", () => {
    assert.equal(isRemoteStoragePath("https://blob.example/file"), true);
    assert.equal(isRemoteStoragePath("abc/file.pdf"), false);
  });

  it("detects sentinel storage paths", () => {
    assert.equal(isSentinelStoragePath("website"), true);
    assert.equal(isSentinelStoragePath("youtube"), true);
    assert.equal(isSentinelStoragePath("pending"), true);
    assert.equal(isSentinelStoragePath("abc/file.pdf"), false);
  });

  it("resolves MIME from filename when browser type is missing", () => {
    assert.equal(
      resolveSourceMediaType({ filename: "notes.txt", fileType: "" }),
      "text/plain"
    );
    assert.equal(
      resolveSourceMediaType({
        filename: "paper.pdf",
        fileType: "application/octet-stream",
      }),
      "application/pdf"
    );
    assert.equal(
      resolveSourceMediaType({ filename: "x.png", fileType: "" }),
      null
    );
    assert.equal(
      resolveSourceMediaType({ filename: "captions.vtt", fileType: "" }),
      "text/vtt"
    );
    // Browsers often mislabel .vtt as text/plain; extension must win so the
    // subtitle parser runs instead of embedding raw timestamps.
    assert.equal(
      resolveSourceMediaType({
        filename: "captions.vtt",
        fileType: "text/plain",
      }),
      "text/vtt"
    );
  });

  it("formats upload errors into useful messages", () => {
    assert.equal(
      formatSourceUploadError(new Error("Notebook not found")),
      "Notebook not found"
    );
    assert.equal(
      formatSourceUploadError(new Error("Unsupported file type")),
      "Unsupported file type. Only PDF, plain text, and VTT subtitles are allowed."
    );
    assert.equal(
      formatSourceUploadError(new Error("PDF parsing boom")),
      "PDF parsing failed"
    );
    assert.equal(
      formatSourceUploadError(new Error("BLOB write failed")),
      "Storage error"
    );
    assert.equal(
      formatSourceUploadError(
        new Error("PDF extraction failed: no embeddable text (image-only PDF).")
      ),
      "PDF extraction failed: no embeddable text (image-only PDF)."
    );
    assert.equal(
      formatSourceUploadError(new Error("Unexpected Prisma P2002 boom")),
      "Database error"
    );
    assert.equal(
      formatSourceUploadError(new Error("secret stacktrace xyz")),
      "Upload failed. Please try again."
    );
  });
});

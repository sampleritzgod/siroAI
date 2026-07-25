import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultTitleFromFilename,
  formatSourceUploadError,
  isRemoteStoragePath,
  isSourceAllowedMediaType,
  resolveSourceMediaType,
  sourceTypeFromMediaType,
} from "@/modules/source/constants";

describe("source constants", () => {
  it("allows only PDF and plain text", () => {
    assert.equal(isSourceAllowedMediaType("application/pdf"), true);
    assert.equal(isSourceAllowedMediaType("text/plain"), true);
    assert.equal(isSourceAllowedMediaType("text/markdown"), false);
    assert.equal(isSourceAllowedMediaType("image/png"), false);
  });

  it("maps media types to source types", () => {
    assert.equal(sourceTypeFromMediaType("application/pdf"), "PDF");
    assert.equal(sourceTypeFromMediaType("text/plain"), "TEXT");
  });

  it("derives titles from filenames", () => {
    assert.equal(defaultTitleFromFilename("Deep Learning.pdf"), "Deep Learning");
    assert.equal(defaultTitleFromFilename("notes.txt"), "notes");
  });

  it("detects remote storage paths", () => {
    assert.equal(isRemoteStoragePath("https://blob.example/file"), true);
    assert.equal(isRemoteStoragePath("abc/file.pdf"), false);
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
  });

  it("formats upload errors into useful messages", () => {
    assert.equal(
      formatSourceUploadError(new Error("Notebook not found")),
      "Notebook not found"
    );
    assert.equal(
      formatSourceUploadError(new Error("Unsupported file type")),
      "Unsupported file type. Only PDF and plain text are allowed."
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
  });
});

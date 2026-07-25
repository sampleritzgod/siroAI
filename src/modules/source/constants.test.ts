import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultTitleFromFilename,
  isRemoteStoragePath,
  isSourceAllowedMediaType,
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
});

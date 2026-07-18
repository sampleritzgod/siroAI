import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAllowedMediaType,
  isExtractableMediaType,
  isImageMediaType,
} from "@/modules/files/constants";

describe("file constants", () => {
  it("allows common image and document types", () => {
    assert.equal(isAllowedMediaType("image/png"), true);
    assert.equal(isAllowedMediaType("application/pdf"), true);
    assert.equal(isAllowedMediaType("application/zip"), false);
  });

  it("detects image vs extractable docs", () => {
    assert.equal(isImageMediaType("image/jpeg"), true);
    assert.equal(isExtractableMediaType("application/pdf"), true);
    assert.equal(isExtractableMediaType("text/plain"), true);
    assert.equal(isExtractableMediaType("image/png"), false);
  });
});

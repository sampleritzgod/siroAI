import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSourceUploadError } from "@/modules/source/constants";
import {
  defaultTitleFromWebsite,
  normalizeWebsiteUrl,
} from "@/modules/source/fetch-website";

describe("website URL helpers", () => {
  it("normalizes http(s) URLs and strips hash / trailing slash", () => {
    assert.equal(
      normalizeWebsiteUrl("https://Example.com/Path/?q=1#section"),
      "https://example.com/Path?q=1"
    );
    assert.equal(
      normalizeWebsiteUrl("https://example.com/docs/"),
      "https://example.com/docs"
    );
    assert.equal(
      normalizeWebsiteUrl("example.com/a"),
      "https://example.com/a"
    );
  });

  it("rejects invalid and private URLs", () => {
    assert.throws(() => normalizeWebsiteUrl(""), /Invalid URL/);
    assert.throws(() => normalizeWebsiteUrl("ftp://example.com"), /Invalid URL/);
    assert.throws(
      () => normalizeWebsiteUrl("http://localhost/secret"),
      /not allowed/
    );
    assert.throws(
      () => normalizeWebsiteUrl("http://127.0.0.1/"),
      /not allowed/
    );
    assert.throws(
      () => normalizeWebsiteUrl("http://192.168.1.10/"),
      /not allowed/
    );
    assert.throws(
      () => normalizeWebsiteUrl("http://169.254.169.254/latest/meta-data/"),
      /not allowed/
    );
  });

  it("builds titles from page title or hostname", () => {
    assert.equal(
      defaultTitleFromWebsite({
        pageTitle: "Hello World",
        url: "https://example.com/x",
      }),
      "Hello World"
    );
    assert.equal(
      defaultTitleFromWebsite({
        pageTitle: null,
        url: "https://www.example.com/x",
      }),
      "example.com"
    );
  });

  it("formats website upload errors", () => {
    assert.equal(
      formatSourceUploadError(new Error("Invalid URL")),
      "Invalid URL. Only http and https are supported."
    );
    assert.equal(
      formatSourceUploadError(new Error("Website unreachable")),
      "Website unreachable"
    );
    assert.equal(
      formatSourceUploadError(new Error("Website fetch timed out")),
      "Website fetch timed out"
    );
    assert.equal(
      formatSourceUploadError(new Error("Empty website content")),
      "Empty website content"
    );
    assert.equal(
      formatSourceUploadError(
        new Error("This website is already added to the notebook.")
      ),
      "This website is already added to the notebook."
    );
  });
});

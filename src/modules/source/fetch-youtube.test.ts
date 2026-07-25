import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSourceUploadError } from "@/modules/source/constants";
import {
  extractYoutubeVideoId,
  isYoutubeUrl,
  normalizeYoutubeUrl,
} from "@/modules/source/fetch-youtube";

describe("youtube URL helpers", () => {
  it("extracts ids from youtube.com and youtu.be forms", () => {
    assert.equal(
      extractYoutubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
      "dQw4w9WgXcQ"
    );
    assert.equal(
      extractYoutubeVideoId("https://youtu.be/dQw4w9WgXcQ"),
      "dQw4w9WgXcQ"
    );
    assert.equal(
      extractYoutubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
      "dQw4w9WgXcQ"
    );
    assert.equal(
      extractYoutubeVideoId("https://www.youtube.com/embed/dQw4w9WgXcQ"),
      "dQw4w9WgXcQ"
    );
    assert.equal(extractYoutubeVideoId("dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  });

  it("normalizes to a canonical watch URL", () => {
    assert.equal(
      normalizeYoutubeUrl("https://youtu.be/dQw4w9WgXcQ?t=12"),
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
  });

  it("detects youtube URLs and rejects others", () => {
    assert.equal(isYoutubeUrl("https://youtu.be/dQw4w9WgXcQ"), true);
    assert.equal(isYoutubeUrl("https://example.com/watch?v=dQw4w9WgXcQ"), false);
    assert.throws(() => extractYoutubeVideoId("https://vimeo.com/123"), /Unsupported/);
    assert.throws(() => extractYoutubeVideoId("not-a-url"), /Invalid|Unsupported/);
  });

  it("formats youtube upload errors", () => {
    assert.equal(
      formatSourceUploadError(new Error("Invalid YouTube URL")),
      "Invalid YouTube URL"
    );
    assert.equal(
      formatSourceUploadError(new Error("No transcript available for this video")),
      "No transcript available for this video"
    );
    assert.equal(
      formatSourceUploadError(new Error("Private or restricted YouTube video")),
      "Private or restricted YouTube video"
    );
    assert.equal(
      formatSourceUploadError(
        new Error("This YouTube video is already added to the notebook.")
      ),
      "This YouTube video is already added to the notebook."
    );
  });
});

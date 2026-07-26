import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CITATION_HREF_PREFIX,
  linkifyCitationMarkers,
  parseCitationHref,
} from "@/modules/conversation/citation-markers";

const valid = new Set([1, 2, 3]);

describe("linkifyCitationMarkers", () => {
  it("links single markers", () => {
    assert.equal(
      linkifyCitationMarkers("Photosynthesis needs light [1].", valid),
      `Photosynthesis needs light [1](${CITATION_HREF_PREFIX}1).`
    );
  });

  it("links adjacent and comma-separated markers", () => {
    assert.equal(
      linkifyCitationMarkers("Both agree [1][2] and [2, 3] too.", valid),
      `Both agree [1](${CITATION_HREF_PREFIX}1)[2](${CITATION_HREF_PREFIX}2) and ` +
        `[2](${CITATION_HREF_PREFIX}2)[3](${CITATION_HREF_PREFIX}3) too.`
    );
  });

  it("leaves unknown indices as plain text (never broken citations)", () => {
    assert.equal(
      linkifyCitationMarkers("See [7] and [1].", valid),
      `See [7] and [1](${CITATION_HREF_PREFIX}1).`
    );
    assert.equal(linkifyCitationMarkers("See [1].", new Set()), "See [1].");
  });

  it("does not touch markdown links, images or reference labels", () => {
    assert.equal(
      linkifyCitationMarkers("[1](https://example.com)", valid),
      "[1](https://example.com)"
    );
    assert.equal(linkifyCitationMarkers("![1](img.png)", valid), "![1](img.png)");
    assert.equal(linkifyCitationMarkers("[text][1]", valid), "[text][1]");
  });

  it("skips inline code and fenced blocks", () => {
    assert.equal(
      linkifyCitationMarkers("Use `arr[1]` here.", valid),
      "Use `arr[1]` here."
    );
    assert.equal(
      linkifyCitationMarkers("```js\nconst a = arr[1];\n```", valid),
      "```js\nconst a = arr[1];\n```"
    );
    assert.equal(
      linkifyCitationMarkers("Text [1]\n```\narr[2]\n```\nmore [3]", valid),
      `Text [1](${CITATION_HREF_PREFIX}1)\n\`\`\`\narr[2]\n\`\`\`\nmore [3](${CITATION_HREF_PREFIX}3)`
    );
  });

  it("returns content untouched when there is nothing to link", () => {
    assert.equal(linkifyCitationMarkers("", valid), "");
    assert.equal(linkifyCitationMarkers("no markers", valid), "no markers");
  });
});

describe("parseCitationHref", () => {
  it("parses citation hrefs and rejects everything else", () => {
    assert.equal(parseCitationHref(`${CITATION_HREF_PREFIX}2`), 2);
    assert.equal(parseCitationHref("https://example.com"), null);
    assert.equal(parseCitationHref(undefined), null);
    assert.equal(parseCitationHref(`${CITATION_HREF_PREFIX}0`), null);
    assert.equal(parseCitationHref(`${CITATION_HREF_PREFIX}abc`), null);
  });
});

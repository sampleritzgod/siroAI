import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSourceUploadError } from "@/modules/source/constants";
import {
  defaultTitleFromVttFilename,
  isVttFilename,
  parseVtt,
} from "@/modules/source/parse-vtt";

const SAMPLE_VTT = `WEBVTT
Kind: captions
Language: en

NOTE This comment must never reach the transcript.

STYLE
::cue {
  color: peachpuff;
}

1
00:00:01.000 --> 00:00:04.000 align:start position:0%
Photosynthesis converts light energy into chemical energy.

2
00:00:04.000 --> 00:00:08.500
<v Narrator>Chlorophyll absorbs sunlight inside the <b>chloroplast</b>.</v>

3
00:00:08.500 --> 00:00:12.000
Plants then produce glucose &amp; oxygen from CO2 and water.
`;

describe("parseVtt", () => {
  it("extracts a clean transcript without timings or metadata", () => {
    const result = parseVtt(SAMPLE_VTT);

    assert.equal(result.cueCount, 3);
    assert.equal(result.language, "en");
    assert.equal(result.durationSeconds, 12);

    assert.match(result.transcript, /Photosynthesis converts light energy/);
    assert.match(result.transcript, /Chlorophyll absorbs sunlight/);
    assert.match(result.transcript, /glucose & oxygen/);

    // No timings, cue numbers, tags, or block metadata.
    assert.doesNotMatch(result.transcript, /-->/);
    assert.doesNotMatch(result.transcript, /00:00/);
    assert.doesNotMatch(result.transcript, /<[^>]+>/);
    assert.doesNotMatch(result.transcript, /WEBVTT|Kind:|Language:/);
    assert.doesNotMatch(result.transcript, /NOTE|STYLE|peachpuff/);
    assert.doesNotMatch(result.transcript, /&amp;/);
  });

  it("handles CRLF, BOM, cues without identifiers, and karaoke timestamps", () => {
    const result = parseVtt(
      "\ufeffWEBVTT\r\n\r\n00:00.000 --> 00:02.000\r\n" +
        "<00:00:00.500>Hello <c.yellow>there</c> friend\r\n\r\n" +
        "00:02.000 --> 00:05.000\r\nSecond cue of the subtitle track\r\n"
    );

    assert.equal(result.cueCount, 2);
    assert.equal(result.transcript, "Hello there friend Second cue of the subtitle track");
  });

  it("collapses rolling duplicate captions", () => {
    const result = parseVtt(`WEBVTT

00:00:01.000 --> 00:00:03.000
the quick brown fox jumps

00:00:03.000 --> 00:00:05.000
the quick brown fox jumps

00:00:05.000 --> 00:00:07.000
over the lazy sleeping dog
`);

    assert.equal(
      result.transcript,
      "the quick brown fox jumps over the lazy sleeping dog"
    );
  });

  it("rejects a file without the WEBVTT header", () => {
    assert.throws(
      () =>
        parseVtt("1\n00:00:01,000 --> 00:00:04,000\nThis is actually SRT.\n"),
      /Invalid VTT file: missing WEBVTT header/
    );
  });

  it("rejects a corrupted (binary) file", () => {
    assert.throws(
      () => parseVtt("WEBVTT\n\n\u0000\u0000\u0000binary garbage"),
      /Corrupted VTT file/
    );
  });

  it("rejects an empty file and a header-only file", () => {
    assert.throws(() => parseVtt("   \n  "), /Empty VTT file/);
    assert.throws(
      () => parseVtt("WEBVTT\nKind: captions\nLanguage: en\n"),
      /Invalid VTT file: no subtitle cues found/
    );
  });

  it("rejects cues that contain no readable text", () => {
    assert.throws(
      () =>
        parseVtt(`WEBVTT

00:00:01.000 --> 00:00:04.000
<v />

00:00:04.000 --> 00:00:06.000

`),
      /Empty VTT file: no readable subtitle text/
    );
  });

  it("derives titles from subtitle filenames", () => {
    assert.equal(
      defaultTitleFromVttFilename("Intro_to_Biology.en.vtt"),
      "Intro to Biology"
    );
    assert.equal(
      defaultTitleFromVttFilename("lecture-04.vtt"),
      "lecture-04"
    );
    assert.equal(isVttFilename("captions.VTT"), true);
    assert.equal(isVttFilename("notes.txt"), false);
  });

  it("surfaces VTT parse failures as user-facing upload errors", () => {
    assert.equal(
      formatSourceUploadError(
        new Error("Invalid VTT file: no subtitle cues found.")
      ),
      "Invalid VTT file: no subtitle cues found."
    );
    assert.equal(
      formatSourceUploadError(
        new Error("This subtitle file is already added to the notebook.")
      ),
      "This subtitle file is already added to the notebook."
    );
    assert.equal(
      formatSourceUploadError(new Error("Unsupported file type")),
      "Unsupported file type. Only PDF, plain text, and VTT subtitles are allowed."
    );
  });
});

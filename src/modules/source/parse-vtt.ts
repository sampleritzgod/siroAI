import { SOURCE_TITLE_MAX_LENGTH } from "@/modules/source/constants";

/** Below this, the file has no useful content to embed. */
export const VTT_MIN_TRANSCRIPT_CHARS = 20;

export type ParsedVtt = {
  transcript: string;
  transcriptBytes: number;
  cueCount: number;
  language: string | null;
  durationSeconds: number | null;
};

/** Stored on Source.metadata for VTT sources. */
export type VttSourceMetadata = {
  cueCount: number;
  language: string | null;
  durationSeconds: number | null;
};

export function toVttMetadata(parsed: ParsedVtt): VttSourceMetadata {
  return {
    cueCount: parsed.cueCount,
    language: parsed.language,
    durationSeconds: parsed.durationSeconds,
  };
}

/** `00:01:02.500` / `01:02.500` / `00:01:02,500` → seconds. */
const TIMESTAMP_RE = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/;

const BLOCK_KEYWORDS = ["NOTE", "STYLE", "REGION", "COMMENT"];

/**
 * Parse a WebVTT subtitle file into a clean, readable transcript.
 *
 * Drops cue timings, cue identifiers / sequence numbers, NOTE / STYLE / REGION
 * blocks, inline cue tags, and blank lines. Consecutive duplicate lines are
 * collapsed, which matters for rolling auto-generated captions.
 */
export function parseVtt(raw: string): ParsedVtt {
  const text = stripBom(raw);

  if (!text.trim()) {
    throw new Error("Empty VTT file: the file has no content.");
  }

  if (looksBinary(text)) {
    throw new Error("Corrupted VTT file: the file is not readable text.");
  }

  if (!hasWebVttHeader(text)) {
    throw new Error(
      "Invalid VTT file: missing WEBVTT header. Export subtitles as WebVTT (.vtt)."
    );
  }

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const language = extractLanguage(lines);

  const cueTexts: string[] = [];
  let cueCount = 0;
  let lastEndSeconds: number | null = null;

  let index = 0;
  // Skip the signature line; header metadata is consumed by the loop below.
  while (index < lines.length && !isWebVttSignature(lines[index]!)) index += 1;
  index += 1;

  while (index < lines.length) {
    const line = lines[index]!;
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (isBlockStart(trimmed)) {
      index = skipBlock(lines, index);
      continue;
    }

    // A cue is an optional identifier line followed by a timing line.
    let timingLine: string | null = null;
    if (isTimingLine(trimmed)) {
      timingLine = trimmed;
      index += 1;
    } else if (
      index + 1 < lines.length &&
      isTimingLine(lines[index + 1]!.trim())
    ) {
      timingLine = lines[index + 1]!.trim();
      index += 2;
    } else {
      // Header metadata (Kind: captions) or stray text — not cue content.
      index += 1;
      continue;
    }

    const end = parseCueEndSeconds(timingLine);
    if (end != null) {
      lastEndSeconds = Math.max(lastEndSeconds ?? 0, end);
    }

    const payload: string[] = [];
    while (index < lines.length && lines[index]!.trim()) {
      // A new timing line means the previous cue was not blank-terminated.
      if (isTimingLine(lines[index]!.trim())) break;
      payload.push(lines[index]!);
      index += 1;
    }

    cueCount += 1;
    const cueText = cleanCueText(payload.join(" "));
    if (cueText) {
      cueTexts.push(cueText);
    }
  }

  if (cueCount === 0) {
    throw new Error("Invalid VTT file: no subtitle cues found.");
  }

  const transcript = joinCues(cueTexts);
  if (transcript.length < VTT_MIN_TRANSCRIPT_CHARS) {
    throw new Error("Empty VTT file: no readable subtitle text found.");
  }

  return {
    transcript,
    transcriptBytes: Buffer.byteLength(transcript, "utf8"),
    cueCount,
    language,
    durationSeconds:
      lastEndSeconds != null && lastEndSeconds > 0
        ? Math.round(lastEndSeconds)
        : null,
  };
}

/** Title from the filename, mirroring other upload source types. */
export function defaultTitleFromVttFilename(filename: string): string {
  const base = filename
    .replace(/\.vtt$/i, "")
    // Subtitle exports often end in a language suffix (talk.en, talk.en-US).
    .replace(/[._-][a-z]{2}(-[A-Za-z]{2,4})?$/i, "")
    .replace(/[._]+/g, " ")
    .trim();
  return (base || "Subtitles").slice(0, SOURCE_TITLE_MAX_LENGTH);
}

export function isVttFilename(filename: string): boolean {
  return /\.vtt$/i.test(filename.trim());
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Null bytes or a high share of replacement characters mean the upload was not
 * UTF-8 subtitle text (e.g. a renamed binary).
 */
function looksBinary(text: string): boolean {
  if (text.includes("\u0000")) return true;
  const sample = text.slice(0, 4000);
  const replacements = (sample.match(/\ufffd/g) ?? []).length;
  return replacements > 0 && replacements / sample.length > 0.05;
}

function hasWebVttHeader(text: string): boolean {
  const firstLine = text.replace(/\r\n?/g, "\n").split("\n", 1)[0] ?? "";
  return isWebVttSignature(firstLine);
}

function isWebVttSignature(line: string): boolean {
  const trimmed = line.trim();
  // "WEBVTT", "WEBVTT - Title", "WEBVTT\tTitle"
  return trimmed === "WEBVTT" || /^WEBVTT[\s\t-]/.test(trimmed);
}

function extractLanguage(lines: string[]): string | null {
  for (const line of lines.slice(0, 10)) {
    const match = /^Language:\s*([A-Za-z-]{2,10})\s*$/.exec(line.trim());
    if (match) return match[1]!.toLowerCase();
  }
  return null;
}

function isBlockStart(trimmed: string): boolean {
  return BLOCK_KEYWORDS.some(
    (keyword) => trimmed === keyword || trimmed.startsWith(`${keyword} `)
  );
}

/** Advance past a NOTE / STYLE / REGION block (ends at a blank line). */
function skipBlock(lines: string[], start: number): number {
  let index = start + 1;
  while (index < lines.length && lines[index]!.trim()) index += 1;
  return index;
}

function isTimingLine(trimmed: string): boolean {
  return trimmed.includes("-->") && /\d/.test(trimmed);
}

function parseCueEndSeconds(timingLine: string): number | null {
  const [, right] = timingLine.split("-->");
  if (!right) return null;
  // Trailing cue settings (align:start position:0%) follow the timestamp.
  const stamp = right.trim().split(/\s+/)[0] ?? "";
  return parseTimestampSeconds(stamp);
}

function parseTimestampSeconds(stamp: string): number | null {
  const match = TIMESTAMP_RE.exec(stamp.trim());
  if (!match) return null;
  const hours = match[1] ? Number.parseInt(match[1], 10) : 0;
  const minutes = Number.parseInt(match[2]!, 10);
  const seconds = Number.parseInt(match[3]!, 10);
  const millis = Number.parseInt(match[4]!.padEnd(3, "0"), 10);
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function cleanCueText(text: string): string {
  return decodeEntities(
    text
      // Inline karaoke timestamps: <00:00:01.500>
      .replace(/<\d{1,3}:\d{2}:\d{2}[.,]\d{1,3}>/g, " ")
      // Cue tags: <v Speaker>, <b>, <c.yellow>, </i>
      .replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lrm;|&rlm;/gi, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10))
    )
    // Ampersand last so decoded entities are not re-decoded.
    .replace(/&amp;/gi, "&");
}

/**
 * Join cues, dropping consecutive duplicates and lines that merely repeat the
 * tail of the previous cue (how rolling captions are usually encoded).
 */
function joinCues(cues: string[]): string {
  const kept: string[] = [];

  for (const cue of cues) {
    const previous = kept[kept.length - 1];
    if (!previous) {
      kept.push(cue);
      continue;
    }
    if (previous.toLowerCase() === cue.toLowerCase()) continue;
    if (previous.toLowerCase().endsWith(cue.toLowerCase())) continue;
    kept.push(cue);
  }

  return kept.join(" ").replace(/\s+/g, " ").trim();
}

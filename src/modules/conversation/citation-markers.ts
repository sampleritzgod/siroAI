/** Href scheme used to hand inline citation markers to the renderer. */
export const CITATION_HREF_PREFIX = "siro-citation:";

/** Returns the citation index when `href` is a citation marker link. */
export function parseCitationHref(href: string | undefined): number | null {
  if (!href?.startsWith(CITATION_HREF_PREFIX)) return null;
  const index = Number(href.slice(CITATION_HREF_PREFIX.length));
  return Number.isInteger(index) && index > 0 ? index : null;
}

/**
 * Rewrite inline citation markers (`[1]`, `[1][2]`, `[1, 2]`) into markdown
 * links so the markdown renderer can turn them into clickable pills.
 *
 * Only indices present in `validIndices` are rewritten — an unmatched marker
 * stays plain text so a citation can never render as a broken link. Code
 * spans and fenced blocks are left untouched.
 */
export function linkifyCitationMarkers(
  content: string,
  validIndices: ReadonlySet<number>
): string {
  if (!content || validIndices.size === 0) return content;

  return splitOutCode(content)
    .map((segment) =>
      segment.isCode ? segment.text : linkifySegment(segment.text, validIndices)
    )
    .join("");
}

function linkifySegment(text: string, validIndices: ReadonlySet<number>) {
  // Consecutive markers (`[1][2]`) are matched as one run so the second one is
  // not mistaken for a reference-style link label.
  const marker = String.raw`\[\d+(?:\s*,\s*\d+)*\]`;
  const pattern = new RegExp(`(!?)((?:${marker})+)(\\(?)`, "g");

  return text.replace(
    pattern,
    (match, bang: string, run: string, openParen: string, offset: number) => {
      // Markdown image / link syntax — leave alone.
      if (bang || openParen) return match;
      // Reference-style link label like [text][1]: a non-numeric bracket group
      // precedes this run (a numeric one would be part of the run).
      if (offset > 0 && text[offset - 1] === "]") return match;

      const indices = [...run.matchAll(/\d+/g)].map((digits) =>
        Number(digits[0])
      );
      if (indices.some((index) => !validIndices.has(index))) return match;

      return indices
        .map((index) => `[${index}](${CITATION_HREF_PREFIX}${index})`)
        .join("");
    }
  );
}

type Segment = { text: string; isCode: boolean };

/** Split into alternating plain / code segments (fenced blocks + inline spans). */
function splitOutCode(content: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /(```[\s\S]*?```|``[\s\S]*?``|`[^`\n]*`)/g;
  let lastIndex = 0;

  for (const match of content.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ text: content.slice(lastIndex, start), isCode: false });
    }
    segments.push({ text: match[0], isCode: true });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < content.length) {
    segments.push({ text: content.slice(lastIndex), isCode: false });
  }

  return segments;
}

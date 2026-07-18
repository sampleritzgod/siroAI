import { isExtractableMediaType } from "@/modules/files/constants";
import { processPdfAttachment } from "@/modules/files/pdf-pages";
import { getLocalAttachmentDir } from "@/modules/files/storage";

const MAX_EXTRACT_CHARS = 40_000;

export type ExtractResult = {
  extractedText: string | null;
  pageImageUrls: string[];
  usedVisionFallback: boolean;
};

/**
 * Extract plain text from PDF / text files.
 * Image-only PDFs fall back to rendered page images (vision).
 */
export async function extractAttachmentContent(input: {
  attachmentId: string;
  filename: string;
  mediaType: string;
  bytes: Buffer;
}): Promise<ExtractResult> {
  if (!isExtractableMediaType(input.mediaType)) {
    return {
      extractedText: null,
      pageImageUrls: [],
      usedVisionFallback: false,
    };
  }

  if (input.mediaType.startsWith("text/")) {
    return {
      extractedText: truncate(input.bytes.toString("utf8")),
      pageImageUrls: [],
      usedVisionFallback: false,
    };
  }

  if (input.mediaType === "application/pdf") {
    const result = await processPdfAttachment({
      attachmentId: input.attachmentId,
      filename: input.filename,
      bytes: input.bytes,
      localDir: getLocalAttachmentDir(input.attachmentId),
    });

    const payload =
      result.pageImageUrls.length > 0
        ? `SIRO_PDF_VISION:${JSON.stringify({
            urls: result.pageImageUrls,
            pageCount: result.pageCount,
          })}\n\n${result.extractedText ?? ""}`
        : result.extractedText;

    return {
      extractedText: payload,
      pageImageUrls: result.pageImageUrls,
      usedVisionFallback: result.usedVisionFallback,
    };
  }

  return {
    extractedText: null,
    pageImageUrls: [],
    usedVisionFallback: false,
  };
}

export function parsePdfVisionPayload(extractedText: string | null | undefined): {
  urls: string[];
  pageCount: number;
  note: string;
} | null {
  if (!extractedText?.startsWith("SIRO_PDF_VISION:")) return null;
  const newline = extractedText.indexOf("\n");
  const jsonPart =
    newline === -1
      ? extractedText.slice("SIRO_PDF_VISION:".length)
      : extractedText.slice("SIRO_PDF_VISION:".length, newline);
  const note = newline === -1 ? "" : extractedText.slice(newline).trim();

  try {
    const parsed = JSON.parse(jsonPart) as {
      urls?: string[];
      pageCount?: number;
    };
    if (!Array.isArray(parsed.urls) || parsed.urls.length === 0) return null;
    return {
      urls: parsed.urls.filter((url) => typeof url === "string"),
      pageCount: parsed.pageCount ?? parsed.urls.length,
      note,
    };
  } catch {
    return null;
  }
}

function truncate(text: string) {
  const normalized = text.replace(/\u0000/g, "").trim();
  if (!normalized) return null;
  if (normalized.length <= MAX_EXTRACT_CHARS) return normalized;
  return `${normalized.slice(0, MAX_EXTRACT_CHARS)}\n\n[…truncated]`;
}

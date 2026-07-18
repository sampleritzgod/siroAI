import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { extractText, renderPageAsImage } from "unpdf";
import { put } from "@vercel/blob";
import { isVercelBlobConfigured } from "@/modules/files/storage";

const MAX_VISION_PAGES = 6;
const RENDER_SCALE = 1.2;

export type PdfProcessResult = {
  extractedText: string | null;
  /** Page image URLs (local /api/files/.../page/N or blob URLs). */
  pageImageUrls: string[];
  pageCount: number;
  usedVisionFallback: boolean;
};

/**
 * Extract text from a PDF. If there is no text layer (scanned/slides),
 * render the first pages as images for vision models.
 *
 * Uses unpdf's serverless PDF.js (inlined worker) + @napi-rs/canvas.
 * Do NOT call definePDFJSModule / pdfjs-dist — that breaks under Next/Turbopack
 * ("Cannot find module .../pdf.worker.mjs").
 */
export async function processPdfAttachment(input: {
  attachmentId: string;
  filename: string;
  bytes: Buffer;
  localDir?: string;
}): Promise<PdfProcessResult> {
  // Fresh copies — PDF.js may transfer/detach ArrayBuffers.
  const { text, totalPages } = await extractText(new Uint8Array(input.bytes), {
    mergePages: true,
  });
  const pageCount = totalPages;
  const joined = (typeof text === "string" ? text : "").trim();

  if (joined.length >= 40) {
    const capped =
      joined.length > 40_000
        ? `${joined.slice(0, 40_000)}\n\n[…truncated]`
        : joined;
    return {
      extractedText: capped,
      pageImageUrls: [],
      pageCount,
      usedVisionFallback: false,
    };
  }

  const pagesToRender = Math.min(pageCount, MAX_VISION_PAGES);
  const pageImageUrls: string[] = [];

  for (let page = 1; page <= pagesToRender; page += 1) {
    try {
      const dataUrl = await renderPageAsImage(new Uint8Array(input.bytes), page, {
        canvasImport: () => import("@napi-rs/canvas"),
        scale: RENDER_SCALE,
        toDataURL: true,
      });

      const base64 = dataUrl.split(",")[1];
      if (!base64) continue;
      const png = Buffer.from(base64, "base64");

      const url = await persistPageImage({
        attachmentId: input.attachmentId,
        localDir: input.localDir,
        pageNumber: page,
        png,
      });
      if (url) pageImageUrls.push(url);
    } catch (error) {
      console.warn(`[pdf] failed to render page ${page}`, error);
    }
  }

  const note =
    pageImageUrls.length > 0
      ? `[PDF has no extractable text layer — ${pageImageUrls.length} of ${pageCount} pages prepared as images for vision.]`
      : `[PDF has no extractable text layer and page rendering failed.]`;

  return {
    extractedText: note,
    pageImageUrls,
    pageCount,
    usedVisionFallback: pageImageUrls.length > 0,
  };
}

async function persistPageImage(input: {
  attachmentId: string;
  localDir?: string;
  pageNumber: number;
  png: Buffer;
}): Promise<string | null> {
  if (isVercelBlobConfigured()) {
    const blob = await put(
      `attachments/${input.attachmentId}/pages/${input.pageNumber}.png`,
      input.png,
      {
        access: "public",
        contentType: "image/png",
        token: process.env.BLOB_READ_WRITE_TOKEN,
      }
    );
    return blob.url;
  }

  if (!input.localDir) return null;

  const pagesDir = path.join(input.localDir, "pages");
  await mkdir(pagesDir, { recursive: true });
  await writeFile(path.join(pagesDir, `${input.pageNumber}.png`), input.png);
  return `/api/files/${input.attachmentId}/page/${input.pageNumber}`;
}

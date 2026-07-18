import {
  isFileUIPart,
  isTextUIPart,
  type FileUIPart,
  type UIMessage,
} from "ai";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isImageMediaType } from "@/modules/files/constants";
import { parsePdfVisionPayload } from "@/modules/files/extract-text";
import { readLocalUpload } from "@/modules/files/storage";

function attachmentIdFromUrl(url: string): string | null {
  try {
    if (url.startsWith("/api/files/")) {
      const rest = url.slice("/api/files/".length).split("?")[0] || "";
      // /api/files/{id} or /api/files/{id}/page/{n}
      return rest.split("/")[0] || null;
    }
    const parsed = new URL(url, "http://localhost");
    const match = parsed.pathname.match(/^\/api\/files\/([^/]+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

async function toDataUrl(mediaType: string, bytes: Buffer): Promise<string> {
  return `data:${mediaType};base64,${bytes.toString("base64")}`;
}

async function resolveLocalFileUrl(
  url: string,
  mediaType: string
): Promise<string> {
  if (!url.startsWith("/api/files/")) return url;

  const parts = url.slice("/api/files/".length).split("/").filter(Boolean);
  const attachmentId = parts[0];
  if (!attachmentId) return url;

  if (parts[1] === "page" && parts[2]) {
    const page = Number(parts[2]);
    if (!Number.isFinite(page)) return url;
    const bytes = await readLocalUpload(
      `${attachmentId}/pages/${page}.png`
    );
    return toDataUrl("image/png", bytes);
  }

  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    select: { storage: true, storageKey: true, mediaType: true },
  });

  if (!attachment || attachment.storage !== "LOCAL") return url;
  const bytes = await readLocalUpload(attachment.storageKey);
  return toDataUrl(attachment.mediaType || mediaType, bytes);
}

/**
 * Rewrite file parts for the model:
 * - Images → data URLs when stored locally (providers can't fetch localhost)
 * - Text PDFs → inject extracted text
 * - Image-only PDFs → inject rendered page images (vision)
 */
export async function prepareMessagesForModel(
  messages: UIMessage[],
  options: { visionEnabled: boolean }
): Promise<UIMessage[]> {
  const attachmentIds = new Set<string>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isFileUIPart(part)) continue;
      const id = attachmentIdFromUrl(part.url);
      if (id) attachmentIds.add(id);
    }
  }

  const attachments =
    attachmentIds.size === 0
      ? []
      : await prisma.attachment.findMany({
          where: { id: { in: [...attachmentIds] }, status: "READY" },
        });

  const byId = new Map(attachments.map((row) => [row.id, row]));

  // Attachments with RAG chunks — don't dump full extracted text into the prompt.
  const indexedIds = new Set<string>();
  if (attachmentIds.size > 0) {
    const ids = [...attachmentIds];
    const rows = await prisma.$queryRaw<Array<{ attachmentId: string }>>`
      SELECT DISTINCT "attachmentId"
      FROM "DocumentChunk"
      WHERE "attachmentId" IN (${Prisma.join(ids)})
    `;
    for (const row of rows) {
      indexedIds.add(row.attachmentId);
    }
  }

  return Promise.all(
    messages.map(async (message) => {
      const nextParts: UIMessage["parts"] = [];
      const docBlocks: string[] = [];

      for (const part of message.parts) {
        if (!isFileUIPart(part)) {
          nextParts.push(part);
          continue;
        }

        const attachmentId = attachmentIdFromUrl(part.url);
        const attachment = attachmentId ? byId.get(attachmentId) : undefined;

        if (isImageMediaType(part.mediaType)) {
          if (!options.visionEnabled) {
            docBlocks.push(
              `[Image attached: ${part.filename ?? attachment?.filename ?? "image"} — current model has no vision]`
            );
            continue;
          }

          nextParts.push({
            ...part,
            url: await resolveLocalFileUrl(part.url, part.mediaType),
          });
          continue;
        }

        // PDF / documents
        const visionPayload = parsePdfVisionPayload(attachment?.extractedText);

        if (visionPayload) {
          if (!options.visionEnabled) {
            docBlocks.push(
              `[PDF “${attachment?.filename ?? part.filename ?? "document"}” has no text layer. Switch to a vision model (e.g. GPT-4o mini) to read page images.]`
            );
            continue;
          }

          docBlocks.push(
            visionPayload.note ||
              `PDF “${attachment?.filename ?? part.filename}” pages follow as images.`
          );

          for (const [index, pageUrl] of visionPayload.urls.entries()) {
            const imagePart: FileUIPart = {
              type: "file",
              mediaType: "image/png",
              filename: `${attachment?.filename ?? "document"}-page-${index + 1}.png`,
              url: await resolveLocalFileUrl(pageUrl, "image/png"),
            };
            nextParts.push(imagePart);
          }
          continue;
        }

        if (attachmentId && indexedIds.has(attachmentId)) {
          docBlocks.push(
            `[Document “${attachment?.filename ?? part.filename ?? "file"}” is indexed — relevant passages are retrieved automatically / via ragSearch.]`
          );
        } else if (
          attachment?.extractedText &&
          !attachment.extractedText.startsWith("SIRO_PDF_VISION:")
        ) {
          docBlocks.push(
            `--- File: ${attachment.filename} ---\n${attachment.extractedText}`
          );
        } else {
          docBlocks.push(
            `[Attached file: ${part.filename ?? attachment?.filename ?? "document"} (${part.mediaType}). No readable text was extracted.]`
          );
        }
      }

      if (docBlocks.length === 0) {
        return { ...message, parts: nextParts };
      }

      const injection = docBlocks.join("\n\n");
      const textIndex = nextParts.findIndex(isTextUIPart);

      if (textIndex >= 0) {
        const textPart = nextParts[textIndex];
        if (textPart && isTextUIPart(textPart)) {
          nextParts[textIndex] = {
            ...textPart,
            text: textPart.text
              ? `${textPart.text}\n\n${injection}`
              : injection,
          };
        }
      } else {
        nextParts.unshift({ type: "text", text: injection });
      }

      return { ...message, parts: nextParts };
    })
  );
}

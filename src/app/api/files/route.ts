import { after } from "next/server";
import { prisma } from "@/lib/db";
import { captureException, logger } from "@/lib/logger";
import { RATE_LIMITS, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireUser } from "@/modules/auth/actions/require-user";
import {
  ALLOWED_MEDIA_TYPES,
  MAX_UPLOAD_BYTES,
  isAllowedMediaType,
} from "@/modules/files/constants";
import { extractAttachmentContent } from "@/modules/files/extract-text";
import { storeUpload } from "@/modules/files/storage";
import { indexAttachmentForRag } from "@/modules/rag/index-attachment";

function jsonError(
  message: string,
  status: number,
  headers?: HeadersInit
) {
  return Response.json({ error: message }, { status, headers });
}

/**
 * POST /api/files — upload an attachment for a conversation.
 * multipart/form-data: file, conversationId
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();

    const limited = await rateLimit({
      scope: "files",
      userId: user.id,
      limit: 30,
      windowSeconds: RATE_LIMITS.chat.windowSeconds,
    });

    if (!limited.success) {
      return jsonError("Too many uploads. Try again shortly.", 429, {
        ...rateLimitHeaders(limited),
        "Retry-After": String(
          Math.max(1, Math.ceil((limited.reset - Date.now()) / 1000))
        ),
      });
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return jsonError("Expected multipart form data", 400);
    }

    const conversationId = String(form.get("conversationId") ?? "").trim();
    const file = form.get("file");

    if (!conversationId) {
      return jsonError("conversationId is required", 400);
    }

    if (!(file instanceof File)) {
      return jsonError("file is required", 400);
    }

    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: user.id },
      select: { id: true },
    });

    if (!conversation) {
      return jsonError("Conversation not found", 404);
    }

    const mediaType = (file.type || "application/octet-stream").toLowerCase();
    if (!isAllowedMediaType(mediaType)) {
      return jsonError(
        `Unsupported file type. Allowed: ${ALLOWED_MEDIA_TYPES.join(", ")}`,
        415
      );
    }

    if (file.size <= 0 || file.size > MAX_UPLOAD_BYTES) {
      return jsonError(
        `File must be between 1 byte and ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB`,
        413
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const filename = file.name?.trim() || "upload";

    const pending = await prisma.attachment.create({
      data: {
        userId: user.id,
        conversationId,
        filename,
        mediaType,
        sizeBytes: bytes.length,
        storage: "LOCAL",
        storageKey: "pending",
        status: "UPLOADING",
      },
    });

    try {
      const stored = await storeUpload({
        attachmentId: pending.id,
        filename,
        mediaType,
        bytes,
      });

      const extracted = await extractAttachmentContent({
        attachmentId: pending.id,
        filename,
        mediaType,
        bytes,
      });

      const ready = await prisma.attachment.update({
        where: { id: pending.id },
        data: {
          storage: stored.storage,
          storageKey: stored.storageKey,
          status: "READY",
          extractedText: extracted.extractedText,
        },
      });

      const extractedText = extracted.extractedText;
      after(async () => {
        try {
          const indexed = await indexAttachmentForRag({
            attachmentId: ready.id,
            conversationId,
            extractedText,
          });
          logger.info("rag_index_complete", {
            attachmentId: ready.id,
            conversationId,
            chunkCount: indexed.chunkCount,
          });
        } catch (error) {
          await captureException(error, {
            attachmentId: ready.id,
            conversationId,
            stage: "rag_index",
          });
        }
      });

      return Response.json({
        id: ready.id,
        url: stored.url,
        mediaType: ready.mediaType,
        filename: ready.filename,
        sizeBytes: ready.sizeBytes,
        hasExtractedText: Boolean(
          extractedText && !extractedText.startsWith("SIRO_PDF_VISION:")
        ),
        usedVisionFallback: extracted.usedVisionFallback,
        pageImages: extracted.pageImageUrls.length,
        indexing: "queued",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Upload failed";
      await prisma.attachment.update({
        where: { id: pending.id },
        data: { status: "FAILED", errorMessage: message.slice(0, 500) },
      });
      throw error;
    }
  } catch (error) {
    console.error("[api/files POST]", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";

    if (/unauthorized/i.test(message)) {
      return jsonError(message, 401);
    }

    return jsonError(message, 500);
  }
}

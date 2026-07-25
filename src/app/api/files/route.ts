import { prisma } from "@/lib/db";
import {
  AppError,
  notFound,
  payloadTooLarge,
  toErrorResponse,
  unauthorized,
  unsupportedMedia,
  validation,
} from "@/lib/errors";
import { captureException, createRequestId, logger } from "@/lib/logger";
import { incrMetric, observeMs } from "@/lib/metrics";
import { RATE_LIMITS, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireUser } from "@/modules/auth/actions/require-user";
import {
  ALLOWED_MEDIA_TYPES,
  isAllowedMediaType,
} from "@/modules/files/constants";
import {
  evaluateUploadSize,
  uploadSizeErrorMessage,
  uploadSizeLogFields,
} from "@/modules/files/upload-size";
import { extractAttachmentContent } from "@/modules/files/extract-text";
import { storeUpload } from "@/modules/files/storage";
import { enqueueAttachmentIndexing } from "@/modules/jobs/enqueue";

export const maxDuration = 60;

/**
 * POST /api/files — upload an attachment for a conversation.
 */
export async function POST(req: Request) {
  const requestId = createRequestId();
  const started = Date.now();

  try {
    let user;
    try {
      user = await requireUser();
    } catch {
      return toErrorResponse(unauthorized(), { "X-Request-Id": requestId });
    }

    const limited = await rateLimit({
      scope: "files",
      userId: user.id,
      ...RATE_LIMITS.files,
    });

    if (!limited.success) {
      incrMetric("rate_limited.files");
      return toErrorResponse(
        new AppError("RATE_LIMITED", "Too many uploads. Try again shortly."),
        {
          ...rateLimitHeaders(limited),
          "Retry-After": String(
            Math.max(1, Math.ceil((limited.reset - Date.now()) / 1000))
          ),
          "X-Request-Id": requestId,
        }
      );
    }

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return toErrorResponse(validation("Expected multipart form data"), {
        "X-Request-Id": requestId,
      });
    }

    const conversationId = String(form.get("conversationId") ?? "").trim();
    const file = form.get("file");

    if (!conversationId) {
      return toErrorResponse(validation("conversationId is required"), {
        "X-Request-Id": requestId,
      });
    }

    if (!(file instanceof File)) {
      return toErrorResponse(validation("file is required"), {
        "X-Request-Id": requestId,
      });
    }

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        userId: user.id,
        notebook: { userId: user.id, deletedAt: null },
      },
      select: { id: true },
    });

    if (!conversation) {
      return toErrorResponse(notFound("Conversation not found"), {
        "X-Request-Id": requestId,
      });
    }

    const mediaType = (file.type || "application/octet-stream").toLowerCase();
    if (!isAllowedMediaType(mediaType)) {
      return toErrorResponse(
        unsupportedMedia(
          `Unsupported file type. Allowed: ${ALLOWED_MEDIA_TYPES.join(", ")}`
        ),
        { "X-Request-Id": requestId }
      );
    }

    const sizeCheck = evaluateUploadSize(file.size);
    logger.info(
      "[UPLOAD_SIZE] check",
      uploadSizeLogFields(sizeCheck, "api/files")
    );
    if (!sizeCheck.ok) {
      return toErrorResponse(
        payloadTooLarge(uploadSizeErrorMessage(sizeCheck)),
        { "X-Request-Id": requestId }
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

      await enqueueAttachmentIndexing({
        attachmentId: ready.id,
        conversationId,
      });

      incrMetric("files.upload");
      observeMs("files.upload_ms", Date.now() - started);

      return Response.json({
        id: ready.id,
        url: stored.url,
        mediaType: ready.mediaType,
        filename: ready.filename,
        sizeBytes: ready.sizeBytes,
        hasExtractedText: Boolean(
          extracted.extractedText &&
            !extracted.extractedText.startsWith("SIRO_PDF_VISION:")
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
    await captureException(error, { stage: "files_upload", requestId });
    logger.error("[api/files POST]", { requestId, error: String(error) });
    incrMetric("files.error");
    return toErrorResponse(error, { "X-Request-Id": requestId });
  }
}

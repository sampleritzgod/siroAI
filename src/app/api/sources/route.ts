import { prisma } from "@/lib/db";
import { captureException, logger } from "@/lib/logger";
import { RATE_LIMITS, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireUser } from "@/modules/auth/actions/require-user";
import { formatSourceUploadError } from "@/modules/source/constants";
import { createSourceFromUpload } from "@/modules/source/service";

function jsonError(
  message: string,
  status: number,
  headers?: HeadersInit
) {
  return Response.json({ error: message }, { status, headers });
}

/**
 * POST /api/sources — upload a PDF or plain-text source for a notebook.
 * multipart/form-data: file, notebookId
 * Extracts text; does not create embeddings.
 */
export async function POST(req: Request) {
  try {
    let user;
    try {
      user = await requireUser();
    } catch {
      return jsonError("Unauthorized", 401);
    }

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

    const notebookId = String(form.get("notebookId") ?? "").trim();
    const file = form.get("file");

    if (!notebookId) {
      return jsonError("Notebook not found", 400);
    }

    if (!(file instanceof File)) {
      return jsonError("file is required", 400);
    }

    logger.info("[UPLOAD] api_received", {
      userId: user.id,
      notebookId,
      filename: file.name,
      type: file.type,
      size: file.size,
    });

    const notebook = await prisma.notebook.findFirst({
      where: { id: notebookId, userId: user.id },
      select: { id: true },
    });

    if (!notebook) {
      return jsonError("Notebook not found", 404);
    }

    const source = await createSourceFromUpload({
      userId: user.id,
      notebookId,
      file,
    });

    return Response.json({
      id: source.id,
      notebookId: source.notebookId,
      type: source.type,
      title: source.title,
      originalFileName: source.originalFileName,
      mimeType: source.mimeType,
      fileSize: source.fileSize,
      indexingStatus: source.indexingStatus,
      hasExtractedText: Boolean(source.extractedText),
    });
  } catch (error) {
    await captureException(error, { stage: "source_upload" });
    const message = formatSourceUploadError(error);
    logger.error("[UPLOAD] api_error", { error: message });

    if (message === "Unauthorized") {
      return jsonError(message, 401);
    }
    if (message === "Notebook not found") {
      return jsonError(message, 404);
    }
    if (/unsupported file type/i.test(message)) {
      return jsonError(message, 415);
    }
    if (/too large|file is empty/i.test(message)) {
      return jsonError(message, 413);
    }
    if (/pdf parsing|no extractable text|text extraction failed/i.test(message)) {
      return jsonError(message, 422);
    }
    if (message === "Storage error") {
      return jsonError(message, 502);
    }
    if (message === "Database error") {
      return jsonError(message, 500);
    }

    return jsonError(message, 500);
  }
}

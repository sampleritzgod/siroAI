import { after } from "next/server";
import { prisma } from "@/lib/db";
import { captureException, logger } from "@/lib/logger";
import { RATE_LIMITS, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireUser } from "@/modules/auth/actions/require-user";
import { formatSourceUploadError } from "@/modules/source/constants";
import { isYoutubeUrl } from "@/modules/source/fetch-youtube";
import {
  createSourceFromUpload,
  createSourceFromWebsite,
  createSourceFromYoutube,
  finalizeSourceIndexing,
} from "@/modules/source/service";

function jsonError(
  message: string,
  status: number,
  headers?: HeadersInit
) {
  return Response.json({ error: message }, { status, headers });
}

function sourceResponse(source: {
  id: string;
  notebookId: string;
  type: string;
  title: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  url?: string | null;
  metadata?: unknown;
  extractedText: string | null;
  indexingStatus: string;
}) {
  return Response.json({
    id: source.id,
    notebookId: source.notebookId,
    type: source.type,
    title: source.title,
    originalFileName: source.originalFileName,
    mimeType: source.mimeType,
    fileSize: source.fileSize,
    url: source.url ?? null,
    metadata: source.metadata ?? null,
    indexingStatus: source.indexingStatus,
    hasExtractedText: Boolean(source.extractedText),
    indexing: "queued",
  });
}

function mapUploadError(message: string) {
  if (message === "Unauthorized") {
    return jsonError(message, 401);
  }
  if (message === "Notebook not found") {
    return jsonError(message, 404);
  }
  if (/already added/i.test(message)) {
    return jsonError(message, 409);
  }
  if (/invalid youtube url|unsupported youtube url|invalid url/i.test(message)) {
    return jsonError(message, 400);
  }
  if (/unsupported file type|unsupported content type/i.test(message)) {
    return jsonError(message, 415);
  }
  if (/too large|file is empty|website content is too large/i.test(message)) {
    return jsonError(message, 413);
  }
  if (
    /pdf extraction|pdf parsing|no extractable text|text extraction failed|embeddings missing|zero chunks|chunking produced|empty website|website unreachable|website fetch timed out|timed out|no transcript|youtube video|private or restricted|youtube transcript/i.test(
      message
    )
  ) {
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

async function queueIndexing(source: { id: string; notebookId: string }) {
  after(async () => {
    try {
      await finalizeSourceIndexing({
        sourceId: source.id,
        notebookId: source.notebookId,
      });
    } catch (error) {
      await captureException(error, {
        stage: "source_index",
        sourceId: source.id,
        notebookId: source.notebookId,
      });
    }
  });
}

/**
 * POST /api/sources
 * - multipart/form-data: file + notebookId (PDF / text)
 * - application/json: { notebookId, url } (website or YouTube)
 * Fast path returns PROCESSING; after() runs chunk/embed → INDEXED.
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

    const contentType = req.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");

    let notebookId = "";
    let file: File | null = null;
    let remoteUrl: string | null = null;

    if (isJson) {
      let body: { notebookId?: string; url?: string };
      try {
        body = await req.json();
      } catch {
        return jsonError("Invalid JSON body", 400);
      }
      notebookId = String(body.notebookId ?? "").trim();
      remoteUrl = String(body.url ?? "").trim() || null;
      if (!remoteUrl) {
        return jsonError("url is required", 400);
      }
    } else {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return jsonError("Expected multipart form data or JSON body", 400);
      }

      notebookId = String(form.get("notebookId") ?? "").trim();
      const formUrl = String(form.get("url") ?? "").trim();
      const formFile = form.get("file");

      if (formUrl) {
        remoteUrl = formUrl;
      } else if (formFile instanceof File) {
        file = formFile;
      } else {
        return jsonError("file or url is required", 400);
      }
    }

    if (!notebookId) {
      return jsonError("Notebook not found", 400);
    }

    const notebook = await prisma.notebook.findFirst({
      where: { id: notebookId, userId: user.id, deletedAt: null },
      select: { id: true },
    });

    if (!notebook) {
      return jsonError("Notebook not found", 404);
    }

    if (remoteUrl) {
      if (isYoutubeUrl(remoteUrl)) {
        logger.info("[UPLOAD] api_received_youtube", {
          userId: user.id,
          notebookId,
          url: remoteUrl,
        });

        const source = await createSourceFromYoutube({
          userId: user.id,
          notebookId,
          url: remoteUrl,
        });
        await queueIndexing(source);
        return sourceResponse(source);
      }

      logger.info("[UPLOAD] api_received_website", {
        userId: user.id,
        notebookId,
        url: remoteUrl,
      });

      const source = await createSourceFromWebsite({
        userId: user.id,
        notebookId,
        url: remoteUrl,
      });
      await queueIndexing(source);
      return sourceResponse(source);
    }

    if (!file) {
      return jsonError("file is required", 400);
    }

    logger.info("[UPLOAD] api_received", {
      userId: user.id,
      notebookId,
      filename: file.name,
      type: file.type,
      size: file.size,
    });

    const source = await createSourceFromUpload({
      userId: user.id,
      notebookId,
      file,
    });
    await queueIndexing(source);
    return sourceResponse(source);
  } catch (error) {
    await captureException(error, { stage: "source_upload" });
    const message = formatSourceUploadError(error);
    logger.error("[UPLOAD] api_error", { error: message });
    return mapUploadError(message);
  }
}

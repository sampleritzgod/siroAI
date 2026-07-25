import { prisma } from "@/lib/db";
import {
  AppError,
  notFound,
  toErrorResponse,
  unauthorized,
  validation,
} from "@/lib/errors";
import { captureException, createRequestId, logger } from "@/lib/logger";
import { incrMetric, observeMs } from "@/lib/metrics";
import { RATE_LIMITS, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireUser } from "@/modules/auth/actions/require-user";
import { enqueueSourceIndexing } from "@/modules/jobs/enqueue";
import { toSourceAppError } from "@/modules/source/constants";
import { isYoutubeUrl } from "@/modules/source/fetch-youtube";
import {
  createSourceFromUpload,
  createSourceFromWebsite,
  createSourceFromYoutube,
} from "@/modules/source/service";

export const maxDuration = 60;

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

/**
 * POST /api/sources
 * - multipart: file + notebookId
 * - JSON: { notebookId, url }
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
      scope: "sources",
      userId: user.id,
      ...RATE_LIMITS.sources,
    });

    if (!limited.success) {
      incrMetric("rate_limited.sources");
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
        return toErrorResponse(validation("Invalid JSON body"), {
          "X-Request-Id": requestId,
        });
      }
      notebookId = String(body.notebookId ?? "").trim();
      remoteUrl = String(body.url ?? "").trim() || null;
      if (!remoteUrl) {
        return toErrorResponse(validation("url is required"), {
          "X-Request-Id": requestId,
        });
      }
    } else {
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        return toErrorResponse(
          validation("Expected multipart form data or JSON body"),
          { "X-Request-Id": requestId }
        );
      }

      notebookId = String(form.get("notebookId") ?? "").trim();
      const formUrl = String(form.get("url") ?? "").trim();
      const formFile = form.get("file");

      if (formUrl) {
        remoteUrl = formUrl;
      } else if (formFile instanceof File) {
        file = formFile;
      } else {
        return toErrorResponse(validation("file or url is required"), {
          "X-Request-Id": requestId,
        });
      }
    }

    if (!notebookId) {
      return toErrorResponse(validation("notebookId is required"), {
        "X-Request-Id": requestId,
      });
    }

    const notebook = await prisma.notebook.findFirst({
      where: { id: notebookId, userId: user.id, deletedAt: null },
      select: { id: true },
    });

    if (!notebook) {
      return toErrorResponse(notFound("Notebook not found"), {
        "X-Request-Id": requestId,
      });
    }

    if (remoteUrl) {
      if (isYoutubeUrl(remoteUrl)) {
        const ytLimit = await rateLimit({
          scope: "youtube",
          userId: user.id,
          ...RATE_LIMITS.youtube,
        });
        if (!ytLimit.success) {
          return toErrorResponse(
            new AppError("RATE_LIMITED", "Too many YouTube imports. Try again shortly."),
            { ...rateLimitHeaders(ytLimit), "X-Request-Id": requestId }
          );
        }

        const source = await createSourceFromYoutube({
          userId: user.id,
          notebookId,
          url: remoteUrl,
        });
        await enqueueSourceIndexing({
          sourceId: source.id,
          notebookId: source.notebookId,
        });
        incrMetric("sources.youtube");
        observeMs("sources.upload_ms", Date.now() - started);
        return sourceResponse(source);
      }

      const webLimit = await rateLimit({
        scope: "website",
        userId: user.id,
        ...RATE_LIMITS.website,
      });
      if (!webLimit.success) {
        return toErrorResponse(
          new AppError("RATE_LIMITED", "Too many website imports. Try again shortly."),
          { ...rateLimitHeaders(webLimit), "X-Request-Id": requestId }
        );
      }

      const source = await createSourceFromWebsite({
        userId: user.id,
        notebookId,
        url: remoteUrl,
      });
      await enqueueSourceIndexing({
        sourceId: source.id,
        notebookId: source.notebookId,
      });
      incrMetric("sources.website");
      observeMs("sources.upload_ms", Date.now() - started);
      return sourceResponse(source);
    }

    if (!file) {
      return toErrorResponse(validation("file is required"), {
        "X-Request-Id": requestId,
      });
    }

    const source = await createSourceFromUpload({
      userId: user.id,
      notebookId,
      file,
    });
    await enqueueSourceIndexing({
      sourceId: source.id,
      notebookId: source.notebookId,
    });
    incrMetric("sources.upload");
    observeMs("sources.upload_ms", Date.now() - started);
    return sourceResponse(source);
  } catch (error) {
    await captureException(error, { stage: "source_upload", requestId });
    const mapped = toSourceAppError(error);
    logger.error("[UPLOAD] api_error", {
      requestId,
      code: mapped.code,
      error: mapped.message,
    });
    incrMetric("sources.error");
    return toErrorResponse(mapped, { "X-Request-Id": requestId });
  }
}

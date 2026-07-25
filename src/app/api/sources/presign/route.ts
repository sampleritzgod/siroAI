import {
  AppError,
  toErrorResponse,
  unauthorized,
  validation,
} from "@/lib/errors";
import { createRequestId } from "@/lib/logger";
import { RATE_LIMITS, rateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { requireUser } from "@/modules/auth/actions/require-user";
import { toSourceAppError } from "@/modules/source/constants";
import { beginSourceDirectUpload } from "@/modules/source/service";

export const maxDuration = 30;

/**
 * POST /api/sources/presign
 * Returns a short-lived S3 PUT URL so the browser uploads directly
 * (bypasses Vercel’s 4.5MB function body limit).
 */
export async function POST(req: Request) {
  const requestId = createRequestId();

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
      return toErrorResponse(
        new AppError("RATE_LIMITED", "Too many uploads. Try again shortly."),
        {
          ...rateLimitHeaders(limited),
          "X-Request-Id": requestId,
        }
      );
    }

    let body: {
      notebookId?: string;
      filename?: string;
      contentType?: string;
      size?: number;
    };
    try {
      body = await req.json();
    } catch {
      return toErrorResponse(validation("Invalid JSON body"), {
        "X-Request-Id": requestId,
      });
    }

    const notebookId = String(body.notebookId ?? "").trim();
    const filename = String(body.filename ?? "").trim();
    const contentType = String(body.contentType ?? "").trim();
    const size = Number(body.size ?? 0);

    if (!notebookId || !filename) {
      return toErrorResponse(
        validation("notebookId and filename are required"),
        { "X-Request-Id": requestId }
      );
    }

    const result = await beginSourceDirectUpload({
      userId: user.id,
      notebookId,
      filename,
      contentType,
      size,
    });

    if (!result) {
      return Response.json(
        { error: "Direct upload unavailable", code: "DIRECT_UPLOAD_UNAVAILABLE" },
        { status: 501, headers: { "X-Request-Id": requestId } }
      );
    }

    return Response.json(
      {
        sourceId: result.sourceId,
        uploadUrl: result.uploadUrl,
        storageKey: result.storageKey,
        mediaType: result.mediaType,
      },
      { headers: { "X-Request-Id": requestId } }
    );
  } catch (error) {
    return toErrorResponse(toSourceAppError(error), {
      "X-Request-Id": requestId,
    });
  }
}

import { toErrorResponse, unauthorized, validation } from "@/lib/errors";
import { createRequestId } from "@/lib/logger";
import { requireUser } from "@/modules/auth/actions/require-user";
import { enqueueSourceIndexing } from "@/modules/jobs/enqueue";
import { toSourceAppError } from "@/modules/source/constants";
import { completeSourceDirectUpload } from "@/modules/source/service";

export const maxDuration = 60;

/**
 * POST /api/sources/complete
 * After the browser PUTs the file to S3, extract text and queue indexing.
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

    let body: { sourceId?: string; notebookId?: string };
    try {
      body = await req.json();
    } catch {
      return toErrorResponse(validation("Invalid JSON body"), {
        "X-Request-Id": requestId,
      });
    }

    const sourceId = String(body.sourceId ?? "").trim();
    const notebookId = String(body.notebookId ?? "").trim();
    if (!sourceId || !notebookId) {
      return toErrorResponse(
        validation("sourceId and notebookId are required"),
        { "X-Request-Id": requestId }
      );
    }

    const source = await completeSourceDirectUpload({
      userId: user.id,
      sourceId,
      notebookId,
    });

    await enqueueSourceIndexing({
      sourceId: source.id,
      notebookId: source.notebookId,
    });

    return Response.json(
      {
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
      },
      { headers: { "X-Request-Id": requestId } }
    );
  } catch (error) {
    return toErrorResponse(toSourceAppError(error), {
      "X-Request-Id": requestId,
    });
  }
}

import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/actions/require-user";
import { readStoredUpload } from "@/modules/files/storage";
import { toErrorResponse, unauthorized } from "@/lib/errors";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/files/[id] — stream a stored attachment (auth + ownership).
 * Denies access when the parent notebook is soft-deleted.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const attachment = await prisma.attachment.findFirst({
      where: {
        id,
        userId: user.id,
        status: "READY",
        conversation: {
          notebook: { userId: user.id, deletedAt: null },
        },
      },
    });

    if (!attachment) {
      return Response.json(
        { error: "File not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    try {
      const object = await readStoredUpload({
        storage: attachment.storage,
        storageKey: attachment.storageKey,
      });
      const headers: Record<string, string> = {
        "Content-Type": object.contentType || attachment.mediaType,
        "Content-Disposition": `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      };
      if (typeof object.contentLength === "number") {
        headers["Content-Length"] = String(object.contentLength);
      }
      return new Response(object.stream, { status: 200, headers });
    } catch {
      return Response.json(
        { error: "File not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }
  } catch (error) {
    console.error("[api/files GET]", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";
    if (/unauthorized/i.test(message)) {
      return toErrorResponse(unauthorized());
    }
    return toErrorResponse(error);
  }
}

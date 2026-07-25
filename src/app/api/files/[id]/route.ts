import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/actions/require-user";
import { readBlobUpload, readLocalUpload } from "@/modules/files/storage";
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

    if (attachment.storage === "VERCEL_BLOB") {
      try {
        const blob = await readBlobUpload(attachment.storageKey);
        return new Response(blob.stream, {
          status: 200,
          headers: {
            "Content-Type": blob.contentType || attachment.mediaType,
            "Content-Disposition": `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
            "Cache-Control": "private, max-age=3600",
          },
        });
      } catch {
        return Response.json(
          { error: "File not found", code: "NOT_FOUND" },
          { status: 404 }
        );
      }
    }

    const bytes = await readLocalUpload(attachment.storageKey);

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": attachment.mediaType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename="${attachment.filename.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
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

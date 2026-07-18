import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/actions/require-user";
import { readLocalUpload } from "@/modules/files/storage";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/files/[id] — stream a locally stored attachment (auth + ownership).
 * Vercel Blob attachments redirect to the public blob URL.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const attachment = await prisma.attachment.findFirst({
      where: { id, userId: user.id, status: "READY" },
    });

    if (!attachment) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    if (attachment.storage === "VERCEL_BLOB") {
      return Response.redirect(attachment.storageKey, 302);
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
      return Response.json({ error: message }, { status: 401 });
    }

    return Response.json({ error: message }, { status: 500 });
  }
}

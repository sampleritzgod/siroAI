import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/actions/require-user";
import {
  buildAttachmentPageStorageKey,
  getLocalPagePath,
  readStoredUploadBytes,
} from "@/modules/files/storage";

type RouteContext = {
  params: Promise<{ id: string; page: string }>;
};

/**
 * GET /api/files/[id]/page/[page] — serve a rendered PDF page image.
 * Denies access when the parent notebook is soft-deleted.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id, page: pageRaw } = await context.params;
    const page = Number(pageRaw);

    if (!Number.isInteger(page) || page < 1 || page > 50) {
      return Response.json(
        { error: "Invalid page", code: "VALIDATION" },
        { status: 400 }
      );
    }

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

    const vision = attachment.extractedText?.startsWith("SIRO_PDF_VISION:");
    if (!vision) {
      return Response.json(
        { error: "Page preview not available", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    if (attachment.storage === "VERCEL_BLOB") {
      try {
        const jsonLine = attachment.extractedText!.slice(
          "SIRO_PDF_VISION:".length
        ).split("\n")[0];
        const parsed = JSON.parse(jsonLine ?? "{}") as { urls?: string[] };
        const url = parsed.urls?.[page - 1];
        if (url) return Response.redirect(url, 302);
      } catch {
        // fall through
      }
      return Response.json(
        { error: "Page not found", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    const bytes =
      attachment.storage === "S3"
        ? await readStoredUploadBytes({
            storage: "S3",
            storageKey: buildAttachmentPageStorageKey(id, page),
          })
        : await readFile(getLocalPagePath(id, page));

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[api/files page GET]", error);
    return Response.json(
      { error: "Page not found", code: "NOT_FOUND" },
      { status: 404 }
    );
  }
}

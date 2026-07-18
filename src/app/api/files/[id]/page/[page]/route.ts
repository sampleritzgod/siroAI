import { readFile } from "node:fs/promises";
import { prisma } from "@/lib/db";
import { requireUser } from "@/modules/auth/actions/require-user";
import { getLocalPagePath } from "@/modules/files/storage";

type RouteContext = {
  params: Promise<{ id: string; page: string }>;
};

/**
 * GET /api/files/[id]/page/[page] — serve a rendered PDF page image.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id, page: pageRaw } = await context.params;
    const page = Number(pageRaw);

    if (!Number.isInteger(page) || page < 1 || page > 50) {
      return Response.json({ error: "Invalid page" }, { status: 400 });
    }

    const attachment = await prisma.attachment.findFirst({
      where: { id, userId: user.id, status: "READY" },
    });

    if (!attachment) {
      return Response.json({ error: "File not found" }, { status: 404 });
    }

    const vision = attachment.extractedText?.startsWith("SIRO_PDF_VISION:");
    if (!vision) {
      return Response.json({ error: "Page preview not available" }, { status: 404 });
    }

    // Blob-backed page URLs are absolute; local uses this route.
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
      return Response.json({ error: "Page not found" }, { status: 404 });
    }

    const bytes = await readFile(getLocalPagePath(id, page));
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
    return Response.json({ error: "Page not found" }, { status: 404 });
  }
}

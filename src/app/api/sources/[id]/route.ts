import { requireUser } from "@/modules/auth/actions/require-user";
import {
  readStoredUpload,
  resolveStorageFromPath,
} from "@/modules/files/storage";
import { isSentinelStoragePath } from "@/modules/source/constants";
import { getSourceForUser } from "@/modules/source/service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/sources/[id] — serve a source file (auth + notebook ownership).
 * Website / YouTube sources redirect to their canonical URL when present.
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const source = await getSourceForUser({ userId: user.id, sourceId: id });

    if (!source || source.storagePath === "pending") {
      return Response.json({ error: "Source not found" }, { status: 404 });
    }

    // URL-backed sources have sentinel storage paths, not file keys.
    if (isSentinelStoragePath(source.storagePath)) {
      if (source.url) {
        return Response.redirect(source.url, 302);
      }
      return Response.json({ error: "Source not found" }, { status: 404 });
    }

    try {
      const object = await readStoredUpload({
        storage: resolveStorageFromPath(source.storagePath),
        storageKey: source.storagePath,
      });
      const headers: Record<string, string> = {
        "Content-Type": object.contentType || source.mimeType,
        "Content-Disposition": `inline; filename="${source.originalFileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      };
      if (typeof object.contentLength === "number") {
        headers["Content-Length"] = String(object.contentLength);
      }
      return new Response(object.stream, { status: 200, headers });
    } catch {
      return Response.json({ error: "Source not found" }, { status: 404 });
    }
  } catch (error) {
    console.error("[api/sources GET]", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";

    if (/unauthorized/i.test(message)) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

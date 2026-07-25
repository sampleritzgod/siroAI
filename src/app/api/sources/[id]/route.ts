import { requireUser } from "@/modules/auth/actions/require-user";
import { readLocalUpload } from "@/modules/files/storage";
import { isRemoteStoragePath } from "@/modules/source/constants";
import { getSourceForUser } from "@/modules/source/service";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/sources/[id] — serve a source file (auth + notebook ownership).
 */
export async function GET(_req: Request, context: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await context.params;

    const source = await getSourceForUser({ userId: user.id, sourceId: id });

    if (!source || source.storagePath === "pending") {
      return Response.json({ error: "Source not found" }, { status: 404 });
    }

    if (isRemoteStoragePath(source.storagePath)) {
      return Response.redirect(source.storagePath, 302);
    }

    const bytes = await readLocalUpload(source.storagePath);

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": source.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename="${source.originalFileName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[api/sources GET]", error);
    const message =
      error instanceof Error ? error.message : "Internal server error";

    if (/unauthorized/i.test(message)) {
      return Response.json({ error: message }, { status: 401 });
    }

    return Response.json({ error: message }, { status: 500 });
  }
}

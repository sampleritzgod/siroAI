export const NOTEBOOK_TITLE_MAX_LENGTH = 100;

export type NotebookTitleValidation =
  | { ok: true; title: string }
  | { ok: false; error: string };

/**
 * Validates and normalizes a notebook title.
 * Title is required after trim; max 100 characters.
 */
export function validateNotebookTitle(title: unknown): NotebookTitleValidation {
  if (typeof title !== "string") {
    return { ok: false, error: "Title is required" };
  }

  const normalized = title.trim();
  if (!normalized) {
    return { ok: false, error: "Title is required" };
  }

  if (normalized.length > NOTEBOOK_TITLE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Title must be at most ${NOTEBOOK_TITLE_MAX_LENGTH} characters`,
    };
  }

  return { ok: true, title: normalized };
}

export type NotebookDescriptionValidation =
  | { ok: true; description: string | null }
  | { ok: false; error: string };

/**
 * Normalizes optional description. Empty / whitespace becomes null.
 */
export function validateNotebookDescription(
  description: unknown
): NotebookDescriptionValidation {
  if (description === undefined || description === null) {
    return { ok: true, description: null };
  }

  if (typeof description !== "string") {
    return { ok: false, error: "Description must be a string" };
  }

  const normalized = description.trim();
  return { ok: true, description: normalized.length > 0 ? normalized : null };
}

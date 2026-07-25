export const ACTIVE_NOTEBOOK_STORAGE_KEY = "siroai:activeNotebookId";

const listeners = new Set<() => void>();

/** In-memory only — notebook the user clicked until the URL catches up. */
let pendingNotebookId: string | null = null;

function emitActiveNotebookChange() {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeActiveNotebook(listener: () => void): () => void {
  listeners.add(listener);

  function onStorage(event: StorageEvent) {
    if (event.key === ACTIVE_NOTEBOOK_STORAGE_KEY) {
      listener();
    }
  }

  if (typeof window !== "undefined") {
    window.addEventListener("storage", onStorage);
  }

  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onStorage);
    }
  };
}

export function readActiveNotebookId(): string | null {
  if (typeof window === "undefined") return null;

  try {
    const value = window.localStorage.getItem(ACTIVE_NOTEBOOK_STORAGE_KEY);
    return value?.trim() || null;
  } catch {
    return null;
  }
}

export function writeActiveNotebookId(notebookId: string): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(ACTIVE_NOTEBOOK_STORAGE_KEY, notebookId);
  } catch {
    // Ignore quota / private-mode failures; selection still works in-session.
  }

  emitActiveNotebookChange();
}

export function clearActiveNotebookId(): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(ACTIVE_NOTEBOOK_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }

  emitActiveNotebookChange();
}

export function readPendingNotebookId(): string | null {
  return pendingNotebookId;
}

export function writePendingNotebookId(notebookId: string | null): void {
  if (pendingNotebookId === notebookId) return;
  pendingNotebookId = notebookId;
  emitActiveNotebookChange();
}

/**
 * Picks a valid active notebook: persisted id if still owned, else newest notebook.
 */
export function resolveActiveNotebookId(
  notebooks: { id: string }[],
  preferredId?: string | null
): string | null {
  if (notebooks.length === 0) return null;

  if (preferredId && notebooks.some((notebook) => notebook.id === preferredId)) {
    return preferredId;
  }

  return notebooks[0]?.id ?? null;
}

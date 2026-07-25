export const PENDING_STARTER_PROMPT_KEY = "siro:pending-starter-prompt";

export type PendingStarterPrompt = {
  conversationId: string;
  text: string;
};

export function readPendingStarterPrompt(): PendingStarterPrompt | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(PENDING_STARTER_PROMPT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PendingStarterPrompt;
  } catch {
    return null;
  }
}

export function clearPendingStarterPrompt() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(PENDING_STARTER_PROMPT_KEY);
}

"use client";

import { useSyncExternalStore } from "react";
import { startNewChat } from "@/modules/conversation/actions/conversation-actions";
import {
  readActiveNotebookId,
  subscribeActiveNotebook,
} from "@/modules/notebook/active-notebook";

/**
 * Home CTA that starts a chat in the persisted active notebook.
 */
export function HomeNewChatButton() {
  const notebookId = useSyncExternalStore(
    subscribeActiveNotebook,
    readActiveNotebookId,
    () => null
  );

  return (
    <form action={startNewChat}>
      {notebookId ? (
        <input type="hidden" name="notebookId" value={notebookId} />
      ) : null}
      <button
        type="submit"
        className="rounded-xl bg-[var(--accent)] px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
      >
        New chat
      </button>
    </form>
  );
}

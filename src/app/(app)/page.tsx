import { requireUser } from "@/modules/auth/actions/require-user";

/**
 * Notebook home is rendered by the Sources | Chat workspace shell.
 * Chat welcome lives in the center panel until a conversation is opened.
 */
export default async function HomePage() {
  await requireUser();
  return null;
}

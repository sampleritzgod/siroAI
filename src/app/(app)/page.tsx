import { requireUser } from "@/modules/auth/actions/require-user";

/**
 * Home is the notebook workspace. The shell renders the selected notebook
 * dashboard; this page intentionally stays empty so chat is not the default.
 */
export default async function HomePage() {
  await requireUser();
  return null;
}

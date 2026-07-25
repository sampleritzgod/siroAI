import { redirect } from "next/navigation";

/**
 * Consensus remains available via API/backend, but is removed from the
 * notebook-first product surface.
 */
export default function ConsensusPage() {
  redirect("/");
}

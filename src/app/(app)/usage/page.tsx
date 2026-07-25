import { redirect } from "next/navigation";

/**
 * Usage remains available via backend metering, but is removed from the
 * notebook-first product surface.
 */
export default function UsagePage() {
  redirect("/");
}

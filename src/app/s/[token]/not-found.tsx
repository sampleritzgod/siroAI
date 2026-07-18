import Link from "next/link";

export default function SharedNotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--background)] px-4 text-[var(--foreground)]">
      <div className="max-w-sm text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted)]">
          SiroAI
        </p>
        <h1 className="mt-2 text-xl font-semibold">Link unavailable</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          This share link is invalid or was revoked by the owner.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block text-sm text-[var(--accent)] underline"
        >
          Go to SiroAI
        </Link>
      </div>
    </div>
  );
}

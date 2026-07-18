"use client";

/**
 * Root error UI — also helps Turbopack resolve the builtin global-error chunk.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
          background: "#0f1115",
          color: "#f4f4f5",
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center" }}>
          <p style={{ opacity: 0.6, fontSize: 12, letterSpacing: "0.16em" }}>
            SIROAI
          </p>
          <h1 style={{ fontSize: 22, margin: "8px 0 12px" }}>
            Something went wrong
          </h1>
          <p style={{ opacity: 0.75, fontSize: 14, lineHeight: 1.5 }}>
            {error.message || "Unexpected application error."}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              border: 0,
              borderRadius: 12,
              padding: "10px 16px",
              background: "#3b82f6",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

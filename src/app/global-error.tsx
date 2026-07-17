"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// A6 — root error boundary. global-error replaces the ROOT layout, so it renders
// its own <html>/<body> and cannot rely on app providers or the Tailwind
// stylesheet; styles are inlined. Catches render crashes at the very top of the
// tree and reports them to Sentry (the last-resort capture).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
          background: "#0b0b0f",
          color: "#e5e7eb",
        }}
      >
        <main
          style={{ maxWidth: "28rem", padding: "2rem", textAlign: "center" }}
        >
          <p
            style={{
              fontSize: "0.75rem",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "#8b8b94",
              margin: "0 0 1rem",
            }}
          >
            POSTORY
          </p>
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p
            style={{ color: "#a1a1aa", margin: "0 0 1.5rem", lineHeight: 1.5 }}
          >
            An unexpected error occurred. Our team has been notified. You can
            try again, and if the problem persists please contact support.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              cursor: "pointer",
              border: 0,
              borderRadius: "0.5rem",
              padding: "0.625rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "#0b0b0f",
              background: "#e5e7eb",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

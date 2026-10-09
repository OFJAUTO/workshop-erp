"use client";

/** The last line of defence: if even the frame fails, a plain white page with a button, never a black screen. */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f4f4f5", color: "#111" }}>
        <div style={{ maxWidth: 560, margin: "80px auto", background: "#fff", border: "1px solid #e4e4e7", borderRadius: 12, padding: 24 }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 15, margin: "0 0 16px" }}>The page could not load. Try again; if it happens again, tell the owner what you were doing.</p>
          {error.digest ? <p style={{ fontSize: 12, color: "#71717a", margin: "0 0 16px" }}>Reference {error.digest}</p> : null}
          <button type="button" onClick={() => reset()} style={{ minHeight: 44, padding: "0 20px", borderRadius: 10, border: 0, background: "#111", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>Try again</button>
          <a href="/home" style={{ marginLeft: 12, fontSize: 15, fontWeight: 700, color: "#111" }}>Go to the start</a>
        </div>
      </body>
    </html>
  );
}

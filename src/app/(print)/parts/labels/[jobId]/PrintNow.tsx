"use client";

/** Opens the print dialog for the labels page. */
export function PrintNow() {
  return (
    <button type="button" onClick={() => window.print()} style={{ background: "#fff", color: "#111", border: 0, borderRadius: 8, padding: "6px 12px", fontWeight: 700, cursor: "pointer" }}>
      Print
    </button>
  );
}

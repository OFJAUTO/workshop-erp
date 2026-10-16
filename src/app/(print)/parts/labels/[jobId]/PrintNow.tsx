"use client";

import { useEffect } from "react";

/** Opens the print dialog for the labels page; with `auto` it opens by itself the moment the page is ready. */
export function PrintNow({ auto = false, label = "Print" }: { auto?: boolean; label?: string }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <button type="button" onClick={() => window.print()} style={{ background: "#fff", color: "#111", border: 0, borderRadius: 8, padding: "6px 12px", fontWeight: 700, cursor: "pointer" }} data-print-now>
      {label}
    </button>
  );
}

"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** The proof of a supplier payment added afterwards: one picker, straight onto the LPO. */
export function SupplierProofUpload({ poId }: { poId: string }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(file: File) {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("po_id", poId);
    fd.set("file", file);
    const r = await fetch("/api/parts/supplier-proof", { method: "POST", body: fd });
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!r.ok || !d.ok) {
      setError(d.error ?? "Could not upload.");
      return;
    }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); e.target.value = ""; }} />
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="min-h-10 rounded-control border-2 border-amber-bar bg-white px-3 text-xs font-bold disabled:opacity-50" data-supplier-proof-upload>
        {busy ? "Uploading…" : "Upload the proof"}
      </button>
      {error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
    </span>
  );
}

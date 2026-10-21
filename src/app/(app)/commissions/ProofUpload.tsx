"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** The signed voucher photo or the bank slip: one picker, straight onto the payment. */
export function ProofUpload({ paymentId, label = "Upload signed voucher" }: { paymentId: string; label?: string }) {
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(file: File) {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("payment_id", paymentId);
    fd.set("file", file);
    const r = await fetch("/api/commissions/proof", { method: "POST", body: fd });
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!r.ok || !d.ok) { setError(d.error ?? "Could not upload."); return; }
    router.refresh();
  }

  return (
    <span className="inline-flex items-center gap-2">
      <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void send(f); e.target.value = ""; }} />
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="min-h-10 rounded-control border-2 border-amber-bar bg-white px-3 text-xs font-bold disabled:opacity-50" data-proof-upload={paymentId}>
        {busy ? "Uploading…" : label}
      </button>
      {error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
    </span>
  );
}

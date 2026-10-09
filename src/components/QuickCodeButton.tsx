"use client";

import { useEffect, useState } from "react";

/**
 * "Continue on my phone": a QR code that signs the same person in on their phone for one minute,
 * single use, straight to this car's screen. A countdown shows how long it is good for; "New code" makes another.
 */
export function QuickCodeButton({ jobId, target, label = "Continue on my phone", compact = false }: { jobId: string; target: string; label?: string; compact?: boolean }) {
  const [code, setCode] = useState<{ qr: string; url: string; expiresAt: number } | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/quick-code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jobId, target }) });
      const data = (await res.json()) as { qr?: string; url?: string; expiresAt?: string; error?: string };
      if (!res.ok || !data.qr || !data.url || !data.expiresAt) throw new Error(data.error ?? "Could not make the code.");
      setCode({ qr: data.qr, url: data.url, expiresAt: Date.parse(data.expiresAt) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not make the code.");
    }
    setBusy(false);
  }
  useEffect(() => {
    if (!code) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((code.expiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [code]);
  const expired = !!code && left <= 0;

  return (
    <div className="flex flex-col gap-2">
      {!code || expired ? (
        <button type="button" disabled={busy} onClick={make} className={`inline-flex ${compact ? "min-h-9 px-2 text-xs" : "min-h-11 px-3 text-sm"} items-center justify-center gap-1.5 rounded-control border border-line-strong bg-white font-semibold hover:border-ink`}>
          {busy ? "Making the code…" : expired ? "New code" : label}
        </button>
      ) : null}
      {code && !expired ? (
        <div className="flex items-center gap-3 rounded-control border border-ink bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={code.qr} alt="QR code" className="h-36 w-36" />
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-bold">Scan with the phone camera</span>
            <span className="text-xs text-muted">Signs you in on the phone for this car. Good for {left} s, one use.</span>
            <button type="button" onClick={make} className="self-start text-xs font-semibold underline underline-offset-4">New code</button>
          </div>
        </div>
      ) : null}
      {expired ? <span className="text-xs text-muted">The code ran out.</span> : null}
      {error ? <span className="text-xs font-semibold text-red">{error}</span> : null}
    </div>
  );
}

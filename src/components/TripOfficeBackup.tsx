"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui";
import { putWithProgress, shrinkPhoto, uploadProblem } from "@/lib/upload-client";
import { reloadIfStale } from "@/lib/app-version";

/**
 * The office's backup when the driver could not press his button (30 October 2026): "Car loaded" (a pick-up) and
 * "Delivered to OFJ", each with the photo if the driver sent it some other way. The photo goes through the same
 * uploader as everywhere (shrunk, straight to storage). Logged as marked by the office.
 */
export function TripOfficeBackup({ tripId, kind, loadedAt, action }: { tripId: string; kind: "pickup" | "delivery"; loadedAt: string | null; action: (step: "loaded" | "delivered", photoPath: string | null) => Promise<{ error?: string; ok?: boolean }> }) {
  const router = useRouter();
  const [open, setOpen] = useState<"loaded" | "delivered" | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (!open) return;
    setError(null);
    let path: string | null = null;
    try {
      if (photo) {
        setBusy("Sending the photo…");
        const small = await shrinkPhoto(photo);
        const prep = await fetch(`/api/recovery/${tripId}/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType: small.type }) });
        const pj = (await prep.json().catch(() => ({}))) as { path?: string; url?: string; error?: string };
        if (!prep.ok || !pj.path || !pj.url) throw Object.assign(new Error(pj.error ?? "Could not prepare the upload."), { status: prep.status });
        await putWithProgress(pj.url, small.blob, small.type, (p) => setBusy(`Sending the photo… ${Math.round(p * 100)}%`));
        path = pj.path;
      }
      setBusy("Saving…");
      const r = await action(open, path);
      if (r.error) setError(r.error);
      else {
        setOpen(null);
        setPhoto(null);
        router.refresh();
      }
    } catch (e) {
      if (!reloadIfStale(e)) setError(uploadProblem(e, (e as { status?: number })?.status ?? null).words);
    }
    setBusy(null);
  };
  return (
    <details className="text-sm" data-trip-office={tripId}>
      <summary className="min-h-11 cursor-pointer font-semibold underline underline-offset-4">The driver could not press his button?</summary>
      <div className="mt-2 flex flex-col gap-2 rounded-control border border-line-strong p-3">
        <div className="flex flex-wrap gap-2">
          {kind === "pickup" && !loadedAt ? <Button type="button" tone={open === "loaded" ? "primary" : "secondary"} size="md" onClick={() => setOpen("loaded")} data-office-loaded>Car loaded</Button> : null}
          <Button type="button" tone={open === "delivered" ? "primary" : "secondary"} size="md" onClick={() => setOpen("delivered")} data-office-delivered>{kind === "pickup" ? "Delivered to OFJ" : "Delivered"}</Button>
        </div>
        {open ? (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1 text-xs font-semibold">
              The photo, if the driver sent it another way (optional)
              <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} className="text-sm" data-office-photo />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="md" disabled={!!busy} onClick={confirm} data-office-confirm>{busy ?? `Mark ${open === "loaded" ? "Car loaded" : kind === "pickup" ? "Delivered to OFJ" : "Delivered"}`}</Button>
              <Button type="button" tone="ghost" size="md" onClick={() => { setOpen(null); setPhoto(null); }}>Cancel</Button>
            </div>
            <span className="text-xs text-muted">Written down as marked by the office. The driver&apos;s price follows on this page.</span>
          </div>
        ) : null}
        {error ? <span className="text-xs font-semibold text-red" data-office-error>{error}</span> : null}
      </div>
    </details>
  );
}

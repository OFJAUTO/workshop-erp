"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { InspectionMedia, type InspectionFile } from "@/components/InspectionMedia";
import { Card, Input, SectionLabel } from "@/components/ui";

/**
 * Step one of every inspection, before anything else on the technician's screen: the scan report.
 * The scanner's email attaches it by itself; the technician can attach the PDF by hand; if a scan is
 * not possible he says why and the workshop manager approves that. The checklist opens only after.
 */
export function ScanStepCard({ inspectionId, files, readAt, approvedAt, notPossibleReason, canAct }: { inspectionId: string; files: InspectionFile[]; readAt: string | null; approvedAt: string | null; notPossibleReason: string | null; canAct: boolean }) {
  const router = useRouter();
  const [list, setList] = useState(files);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = !!readAt || !!approvedAt;

  async function send(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/inspection/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inspectionId, ...body }) });
    const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusy(false);
    if (!r.ok || !d.ok) { setError(d.error ?? "Could not save."); return; }
    router.refresh();
  }

  return (
    <Card className={`flex flex-col gap-3 ${done ? "border-green" : "border-ink ring-2 ring-ink"}`}>
      <SectionLabel right={done ? "done" : list.length ? `${list.length} attached` : "required first"}>Step 1 · Scan report</SectionLabel>
      {done ? (
        <p className="text-sm font-semibold text-green">{readAt ? "Scan report read. The inspection is open." : "Scan not possible, approved by the workshop manager. The inspection is open."}</p>
      ) : (
        <p className="text-sm">Plug in the scanner and run the scan. The report arrives here by email, or attach the PDF by hand. Then tap that you have read it. If a scan is not possible, say why; the workshop manager approves that.</p>
      )}
      <InspectionMedia inspectionId={inspectionId} files={list} where={{ isPrescan: true }} accept="pdf" disabled={!canAct} onAdded={(f) => setList((l) => [...l, f])} />
      {!done && canAct ? (
        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <button type="button" disabled={!list.length || busy} onClick={() => send({ inspection: { scan_read: true } })} className={`min-h-14 rounded-control text-base font-extrabold ${list.length ? "bg-ink text-white" : "bg-chip text-muted"}`}>
            I have read the scan report
          </button>
          {notPossibleReason ? (
            <p className="text-sm font-semibold text-amber">Scan not possible: {notPossibleReason}. Waiting for the workshop manager&apos;s approval.</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 flex-1 min-w-48">
                <span className="text-xs font-semibold text-muted">Scan not possible because</span>
                <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: no OBD power, module not reachable" textCase="sentence" />
              </label>
              <button type="button" disabled={reason.trim().length < 3 || busy} onClick={() => send({ inspection: { scan_not_possible_reason: reason.trim() } })} className="min-h-11 rounded-control border border-line-strong bg-white px-4 text-sm font-bold disabled:opacity-50">Ask the manager to approve</button>
            </div>
          )}
          {error ? <p className="text-sm font-semibold text-red">{error}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

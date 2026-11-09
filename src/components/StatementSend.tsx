"use client";

import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { reloadIfStale } from "@/lib/app-version";
import { statementLinkAction, type StatementLink } from "@/app/(app)/customers/[id]/statement/actions";

/** Send the statement, or tick proformas and send ONE bill for several cars (9 November 2026, Section 3). */
export function StatementSend({ customerId, proformas, canSend }: { customerId: string; proformas: { invoiceId: string; label: string }[]; canSend: boolean }) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [payLink, setPayLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [send, setSend] = useState<(StatementLink & { kind: string }) | null>(null);
  async function make(kind: "statement" | "combined") {
    setBusy(true);
    setError(null);
    try {
      const r = await statementLinkAction(customerId, kind, Array.from(ticked), kind === "combined" ? payLink.trim() || null : null);
      setBusy(false);
      if (r.error || !r.link) { setError(r.error ?? "Couldn't make the link. Try again."); return; }
      setSend({ ...r, kind });
    } catch (e) {
      setBusy(false);
      if (!reloadIfStale(e)) setError("No connection. Try again.");
    }
  }
  if (!canSend) return null;
  return (
    <div className="flex flex-col gap-3" data-statement-send>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="md" disabled={busy} onClick={() => void make("statement")} data-statement-send-open>Send the statement</Button>
      </div>
      {proformas.length >= 2 ? (
        <div className="flex flex-col gap-2 rounded-control border border-line p-3" data-combined-bill>
          <span className="text-sm font-bold">One bill for several cars</span>
          <span className="text-xs text-muted">Tick the proformas: the customer gets one bill with the total (each car keeps its own tax invoice when paid).</span>
          {proformas.map((p) => (
            <label key={p.invoiceId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ticked.has(p.invoiceId)} onChange={(e) => setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(p.invoiceId); else n.delete(p.invoiceId); return n; })} className="h-5 w-5 accent-ink" data-combined-tick={p.label} /><span className="uppercase">{p.label}</span></label>
          ))}
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Payment link for the total (optional)</span><Input value={payLink} onChange={(e) => setPayLink(e.target.value)} placeholder="Paste the bank's payment link" data-combined-paylink /></label>
          <div><Button type="button" size="md" disabled={busy || ticked.size < 2} onClick={() => void make("combined")} data-combined-send>Send one bill ({ticked.size})</Button></div>
        </div>
      ) : null}
      {error ? <p className="text-sm font-semibold text-red" data-statement-error>{error}</p> : null}
      {send ? (
        <SendLinkDialog
          title={send.kind === "combined" ? "Send one bill" : "Send the statement"}
          message={send.message ?? ""}
          phoneDigits={send.phoneDigits ?? ""}
          onSent={() => null}
          onClose={() => setSend(null)}
        />
      ) : null}
      {send?.email ? <a href={`mailto:${send.email}?subject=${encodeURIComponent(send.subject ?? "")}&body=${encodeURIComponent(send.message ?? "")}`} className="text-sm font-bold underline underline-offset-4" data-statement-email>Send by email instead ({send.email})</a> : null}
    </div>
  );
}

"use client";

import { newUuid } from "@/lib/uuid";
import { PositionsLine } from "@/components/PositionsLine";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SupplierInvoiceBox } from "@/components/SupplierInvoiceBox";
import { Button } from "@/components/ui";

export type ReceiveRow = { id: string; description: string; positions?: string[] | null; qty: number; supplier: string | null; state: string | null; poId: string | null };
export type ReceivedRow = { id: string; description: string; positions?: string[] | null; qty: number };
type Action = (formData: FormData) => Promise<{ error?: string; ok?: boolean; message?: string }>;

// A real uuid: a supplier invoice scan uploaded before the save is tied to it in job_files.ref_id (a uuid column).
const newKey = () => newUuid();

/**
 * Receiving parts from the supplier, all on this page: a tick box per line, Select all, "Mark N received",
 * then one panel with a sticker switch per part (one sticker per unit), THE supplier-invoice box
 * (SupplierInvoiceBox: number + date compulsory or "Invoice to follow", amount cross-checked, photos with X),
 * and "Print stickers" / "No stickers". Received lines stay underneath, collapsed and light green.
 */
export function ReceivePanel({ jobId, rows, received, canAct, action, poTotals = {} }: { jobId: string; rows: ReceiveRow[]; received: ReceivedRow[]; canAct: boolean; action: Action; /** LPO totals before VAT by po id, for the invoice-amount cross-check. */ poTotals?: Record<string, number> }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState(false);
  const [noSticker, setNoSticker] = useState<Set<string>>(new Set());
  const [clientKey, setClientKey] = useState(newKey);
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const ticked = rows.filter((r) => !unticked.has(r.id));
  // The amount cross-check works when every ticked part sits on the SAME LPO; a mixed tick skips it.
  const tickedPoIds = Array.from(new Set(ticked.map((r) => r.poId)));
  const singlePoId = tickedPoIds.length === 1 && tickedPoIds[0] ? tickedPoIds[0] : null;
  const poTotal = singlePoId ? (poTotals[singlePoId] ?? null) : null;
  const toggle = (id: string) => setUnticked((u) => { const n = new Set(u); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const submit = (print: boolean) => start(async () => {
    setMsg(null);
    const fd = formRef.current ? new FormData(formRef.current) : new FormData();
    for (const r of ticked) fd.append("part", r.id);
    const stickerIds = ticked.filter((r) => !noSticker.has(r.id)).map((r) => r.id);
    const r = await action(fd);
    if (r.error) { setMsg({ tone: "error", text: r.error }); return; }
    if (print && stickerIds.length) window.open(`/parts/labels/${jobId}?parts=${stickerIds.join(",")}&auto=1`, "_blank", "noopener");
    setMsg({ tone: "success", text: r.message ?? "Received." });
    setPanel(false);
    setUnticked(new Set());
    setNoSticker(new Set());
    setClientKey(newKey());
    router.refresh();
  });
  return (
    <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3" data-receive-panel>
      {rows.length ? (
        <>
          <ul className="flex flex-col gap-1 text-sm">
            {rows.map((r) => {
              const on = canAct && !unticked.has(r.id);
              return (
                <li key={r.id} data-receive-row={r.id}>
                  <button type="button" disabled={!canAct || panel} onClick={() => toggle(r.id)} aria-pressed={on} className={`flex w-full min-h-12 items-center gap-3 rounded-control px-2 text-left ${on ? "bg-chip" : ""}`}>
                    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control border text-xs font-bold ${on ? "border-ink bg-ink text-white" : "border-line-strong text-transparent"}`}>✓</span>
                    <span className="flex flex-1 flex-col"><span className="font-semibold">{r.description}</span><PositionsLine positions={r.positions} /></span>
                    <span className="text-muted">× {r.qty}</span>
                    <span className="text-xs font-semibold text-muted">{r.supplier ? `${r.supplier} · ` : ""}{r.state ?? ""}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {canAct && !panel ? (
            <div className="flex flex-wrap items-center gap-2">
              {rows.length > 1 ? (
                <button type="button" onClick={() => setUnticked(unticked.size ? new Set() : new Set(rows.map((r) => r.id)))} className="min-h-9 px-2 text-xs font-bold underline underline-offset-4" data-receive-select-all>
                  {unticked.size ? "Select all" : "Unselect all"}
                </button>
              ) : null}
              <Button type="button" size="lg" disabled={!ticked.length} onClick={() => setPanel(true)} data-mark-received>Mark {ticked.length} received</Button>
            </div>
          ) : null}
          {canAct && panel ? (
            <div className="flex flex-col gap-3 rounded-card border-2 border-ink bg-white p-4" data-receive-confirm>
              <span className="text-sm font-extrabold uppercase tracking-[0.08em]">Receiving {ticked.length} part{ticked.length === 1 ? "" : "s"}</span>
              <ul className="flex flex-col gap-1 text-sm">
                {ticked.map((r) => {
                  const sticker = !noSticker.has(r.id);
                  return (
                    <li key={r.id} className="flex items-center gap-3 min-h-11" data-sticker-row={r.id}>
                      <span className="flex flex-1 flex-col"><span className="font-semibold">{r.description}<span className="font-normal text-muted"> × {r.qty}</span></span><PositionsLine positions={r.positions} /></span>
                      <button type="button" onClick={() => setNoSticker((u) => { const n = new Set(u); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} aria-pressed={sticker} data-sticker-switch className={`inline-flex min-h-9 items-center gap-1.5 rounded-control border px-3 text-xs font-bold ${sticker ? "border-ink bg-ink text-white" : "border-line-strong bg-white text-muted"}`}>
                        {sticker ? `Stickers × ${r.qty}` : "No sticker"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <input type="hidden" name="client_key" value={clientKey} />
              <SupplierInvoiceBox jobId={jobId} poId={singlePoId} poTotal={poTotal} clientKey={clientKey} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="lg" disabled={pending} onClick={() => submit(true)} data-print-stickers>{pending ? "Saving…" : "Print stickers"}</Button>
                <Button type="button" tone="secondary" size="lg" disabled={pending} onClick={() => submit(false)} data-no-stickers>No stickers</Button>
                <Button type="button" tone="ghost" size="lg" onClick={() => setPanel(false)}>Back</Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {msg ? <span className={`text-sm font-semibold ${msg.tone === "error" ? "text-red" : "text-green"}`} role="alert">{msg.text}</span> : null}
      {received.length ? (
        <details data-received-list>
          <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold">Received ({received.length})</summary>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {received.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-control bg-green-soft px-2 py-2" data-received-line={r.id}>
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green text-xs font-bold text-white">✓</span>
                <span className="flex flex-col"><span className="font-semibold">{r.description}</span><PositionsLine positions={r.positions} /></span><span className="text-muted">× {r.qty}</span>
                <span className="ml-auto text-xs font-semibold text-green">Received</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </form>
  );
}

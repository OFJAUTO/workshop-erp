"use client";

import { PositionsLine } from "@/components/PositionsLine";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { ReceiptInvoiceFields, type ReceiptSupplier } from "@/components/ReceiptInvoiceFields";

export type ReceiveRow = { id: string; description: string; positions?: string[] | null; qty: number; supplier: string | null; state: string | null; poId: string | null };
export type ReceivedRow = { id: string; description: string; positions?: string[] | null; qty: number; /** The LPO's invoice is not entered yet: accounts collect and scan it (4 November 2026). */ invoiceWithAccounts?: boolean };
type Action = (formData: FormData) => Promise<{ error?: string; ok?: boolean; message?: string }>;

/**
 * Receiving parts from the supplier, all on this page: a tick box per line, Select all, "Mark N received",
 * then one panel with a sticker switch per part (one sticker per unit) and "Print stickers" / "No stickers".
 * Since 4 November 2026 receiving never asks for the invoice: the supplier's paper goes to ACCOUNTS, who
 * collect it from Parts, scan it and enter it (the received lines read "invoice with accounts" until then).
 */
export function ReceivePanel({ jobId, rows, received, canAct, action, receiptSuppliers = null }: { jobId: string; rows: ReceiveRow[]; received: ReceivedRow[]; canAct: boolean; action: Action; /** 13 November 2026: per LPO, the supplier and its "invoice later" rule (null until the database update). */ receiptSuppliers?: Record<string, { supplier: ReceiptSupplier; dueOn: string | null }> | null }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [panel, setPanel] = useState(false);
  const [noSticker, setNoSticker] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [pending, start] = useTransition();
  const ticked = rows.filter((r) => !unticked.has(r.id));
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
                    <span className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-control border text-xs font-bold ${on ? "border-ink bg-ink text-on-dark" : "border-line-strong text-transparent"}`}>✓</span>
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
                      <button type="button" onClick={() => setNoSticker((u) => { const n = new Set(u); if (n.has(r.id)) n.delete(r.id); else n.add(r.id); return n; })} aria-pressed={sticker} data-sticker-switch className={`inline-flex min-h-9 items-center gap-1.5 rounded-control border px-3 text-xs font-bold ${sticker ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white text-muted"}`}>
                        {sticker ? `Stickers × ${r.qty}` : "No sticker"}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {receiptSuppliers && ticked.some((r) => r.poId && receiptSuppliers[r.poId]) ? (() => {
                const first = ticked.find((r) => r.poId && receiptSuppliers[r.poId])!;
                const s = receiptSuppliers[first.poId!];
                const pos = Array.from(new Set(ticked.map((r) => r.poId).filter((x): x is string => !!x)));
                return <ReceiptInvoiceFields key={pos.join(",")} supplier={s.supplier} poIds={pos} dueOn={s.dueOn} />;
              })() : <p className="text-xs text-muted" data-receive-invoice-note>The supplier&apos;s invoice is NOT entered here: keep the paper at the desk – accounts collect and scan it (they are told the moment you save).</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="lg" disabled={pending} onClick={() => submit(true)} data-print-stickers>{pending ? "Saving…" : "Print stickers"}</Button>
                <Button type="button" tone="secondary" size="lg" disabled={pending} onClick={() => submit(false)} data-no-stickers>No stickers</Button>
                <Button type="button" tone="ghost" size="lg" onClick={() => setPanel(false)}>Back</Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {msg ? <span className={`text-sm font-semibold ${msg.tone === "error" ? "text-red" : "text-green-text"}`} role="alert">{msg.text}</span> : null}
      {received.length ? (
        <details data-received-list>
          <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold">Received ({received.length})</summary>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {received.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-control bg-green-soft px-2 py-2" data-received-line={r.id}>
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green text-xs font-bold text-on-dark">✓</span>
                <span className="flex flex-col"><span className="font-semibold">{r.description}</span><PositionsLine positions={r.positions} /></span><span className="text-muted">× {r.qty}</span>
                <span className="ml-auto text-xs font-semibold text-green-text" data-received-words={r.invoiceWithAccounts ? "invoice-with-accounts" : "received"}>{r.invoiceWithAccounts ? "Received · invoice with accounts" : "Received"}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </form>
  );
}

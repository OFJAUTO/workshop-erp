"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { previewBySupplier, type SelectRow } from "@/lib/lpo-select";
import { addSupplierMoney, supplierMoney, supplierMoneyText } from "@/lib/supplier-money";
import { reloadIfStale } from "@/lib/app-version";
import { CheckBeforeSend } from "@/components/CheckBeforeSend";
import { logSendCheckAction } from "../send-check-actions";

const aed = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * SEND LPO FOR SELECTED (8 November 2026, Peter): the parts desk ticks only the parts it orders now. Only an approved,
 * finished line on no LPO can be ticked; every other line says why (a repeated part number or an unfinished line in
 * red). Before sending, the preview shows each supplier's parts and the amount incl. VAT; the rest stay "Approved – to
 * order" for a later LPO.
 */
export function LpoSelect({ rows, vatSupplierNames, pendingNumber, send, jobId = null, checks = null }: { rows: SelectRow[]; vatSupplierNames: string[]; pendingNumber: string | null; send: (ids: string[]) => Promise<{ error?: string; message?: string }>; jobId?: string | null; /** 13 November 2026: per part, its part number, delivery and what looks wrong (CHECK BEFORE YOU SEND). */ checks?: Record<string, { partNumber: string | null; delivery: string | null; flags: string[] }> | null }) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState(false);
  const [answer, setAnswer] = useState<{ error?: string; message?: string } | null>(null);
  const [busy, start] = useTransition();
  const eligible = rows.filter((r) => r.eligible);
  const suppliers = Array.from(new Set(eligible.map((r) => r.supplier))).sort();
  const vat = useMemo(() => new Set(vatSupplierNames.map((n) => n.trim().toLowerCase())), [vatSupplierNames]);
  const blocks = previewBySupplier(rows, ticked);
  const moneyOf = (supplier: string, net: number) => supplierMoney(net, { chargesVat: vat.has(supplier.trim().toLowerCase()) });
  const total = addSupplierMoney(blocks.map((b) => moneyOf(b.supplier, b.net)));
  const toggle = (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const n = blocks.reduce((a, b) => a + b.parts.length, 0);
  const deliveryOf = (ids: string[]) => {
    const ds = ids.map((id) => checks?.[id]?.delivery).filter((d): d is string => !!d);
    return ds.length ? Array.from(new Set(ds)).join(" · ") : null;
  };
  const go = (flags: { key: string; name: string; flags: string[] }[]) =>
    start(async () => {
      try {
        await logSendCheckAction("lpo_approval", { jobId, partIds: Array.from(ticked) }, flags).catch(() => null);
        const r = await send(Array.from(ticked));
        setAnswer(r);
        if (!r.error) { setTicked(new Set()); setPreview(false); router.refresh(); }
      } catch (e) {
        if (reloadIfStale(e)) return;
        setAnswer({ error: "No connection – nothing was sent. Try again." });
      }
    });
  return (
    <div className="flex flex-col gap-3" data-lpo-select>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-bold">Tick the parts you are ordering now</span>
        <Button type="button" size="md" tone="secondary" onClick={() => setTicked(new Set(eligible.map((r) => r.id)))} disabled={!eligible.length} data-lpo-select-all>Select all approved</Button>
        {suppliers.length > 1 ? suppliers.map((s) => (
          <Button key={s} type="button" size="md" tone="secondary" onClick={() => setTicked(new Set(eligible.filter((r) => r.supplier === s).map((r) => r.id)))} data-lpo-select-supplier={s}>Only {s}</Button>
        )) : null}
        {ticked.size ? <Button type="button" size="md" tone="secondary" onClick={() => setTicked(new Set())} data-lpo-select-clear>Clear</Button> : null}
      </div>
      <ul className="flex flex-col divide-y divide-line rounded-card border border-line">
        {rows.map((r) => (
          <li key={r.id} className={`flex flex-wrap items-start gap-3 px-3 py-2 ${r.eligible ? "" : "bg-chip/60"}`} data-lpo-line={r.id} data-lpo-eligible={r.eligible ? "1" : "0"}>
            <label className="flex min-h-11 flex-1 min-w-0 cursor-pointer items-start gap-3">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={ticked.has(r.id)} disabled={!r.eligible || busy} onChange={() => toggle(r.id)} data-lpo-pick={r.id} />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-bold uppercase">{r.name}</span>
                <span className="text-xs text-muted">{r.supplier || "No supplier"} · qty {r.quantity} · AED {aed(r.cost * r.quantity)} before VAT</span>
                {r.why ? <span className={`text-xs font-semibold ${r.red ? "text-red" : "text-muted"}`} data-lpo-why data-lpo-why-red={r.red ? "1" : "0"}>{r.why}</span> : <span className="text-xs font-semibold text-green-text">Approved – to order</span>}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="lg" disabled={!n || busy} onClick={() => { setAnswer(null); setPreview(true); }} data-send-lpo-selected>{pendingNumber ? `Add selected to ${pendingNumber} (${n})` : `Send LPO for selected (${n})`}</Button>
        {n ? <span className="text-sm text-muted" data-lpo-select-total>{supplierMoneyText(total)}</span> : null}
      </div>
      {answer?.error ? <p className="text-sm font-semibold text-red" role="alert" data-lpo-selected-error>{answer.error}</p> : null}
      {answer?.message ? <p className="text-sm font-semibold text-green-text" data-lpo-selected-done>{answer.message}</p> : null}
      <CheckBeforeSend
        open={preview}
        title={pendingNumber ? `Add ${n} part${n === 1 ? "" : "s"} to ${pendingNumber}?` : `Send ${n} part${n === 1 ? "" : "s"} for approval?`}
        groups={blocks.map((b) => ({ title: b.supplier, amount: supplierMoneyText(moneyOf(b.supplier, b.net)), delivery: deliveryOf(b.parts.map((p) => p.id)), lines: b.parts.map((p) => ({ key: p.id, name: p.name, partNumber: checks?.[p.id]?.partNumber ?? null, qty: p.quantity, price: p.quantity ? Math.round((p.net / p.quantity) * 100) / 100 : null, flags: checks?.[p.id]?.flags ?? [] })) }))}
        total={supplierMoneyText(total)}
        extra={rows.length - n > 0 ? <p className="text-xs text-muted">{rows.length - n} other line{rows.length - n === 1 ? "" : "s"} stay{rows.length - n === 1 ? "s" : ""} as they are for a later LPO.</p> : null}
        busy={busy}
        error={answer?.error ?? null}
        onBack={() => setPreview(false)}
        onSend={(flags) => go(flags)}
      />
    </div>
  );
}

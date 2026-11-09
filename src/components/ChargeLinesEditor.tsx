"use client";

import { useState } from "react";
import { Input } from "@/components/ui";
import { CHARGE_KINDS, type ChargeKind } from "@/lib/charge-rules";

type RecoveryType = { key: string; label: string; cost: number; price: number };
type Row = { kind: ChargeKind; description: string; provider: string; recovery_type: string; trips: string; litres: string; cost: string; trn: string; charge: string; free: boolean; different: boolean };

const blank = (kind: ChargeKind = "recovery"): Row => ({ kind, description: "", provider: "", recovery_type: "", trips: "1", litres: "", cost: "", trn: "", charge: "", free: false, different: false });
const num = (s: string) => {
  const n = Number(String(s).replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
};

/**
 * THE cost and charge lines (1 November 2026, B2), the same on the job card (early charges) and on Pending charges.
 * Each line: Recovery (provider from the saved list or typed, type, trips) / Fuel (litres) / Other (what it is), its
 * COST (what we pay, the supplier's TRN) and its CHARGE (what the customer pays, before VAT) or Free. The lines travel
 * as one hidden field ("lines", JSON) with the form around it.
 *
 * 8.2 (3 November 2026): when the car already has a recovery (on a quotation, or typed on the job card), a Recovery row
 * shows it in amber and asks once - "Yes, it is a different trip" must be ticked to save it (the server checks again).
 */
export function ChargeLinesEditor({ name = "lines", recoveryTypes, providers, startKind = "recovery", recoveryAlready = [] }: { name?: string; recoveryTypes: RecoveryType[]; providers: string[]; startKind?: ChargeKind; /** The recoveries already on the car, in words ("RECOVERY, FULL DOWN, TWO WAYS · AED 400.00 · on Q-00039 · approved"). */ recoveryAlready?: string[] }) {
  const [rows, setRows] = useState<Row[]>([blank(startKind)]);
  const set = (i: number, patch: Partial<Row>) => setRows((p) => p.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const pickType = (i: number, key: string) => {
    const t = recoveryTypes.find((x) => x.key === key);
    const trips = Math.max(1, Math.round(num(rows[i].trips) || 1));
    set(i, { recovery_type: key, ...(t ? { cost: rows[i].cost || String(t.cost * trips), charge: rows[i].charge || String(t.price * trips) } : {}) });
  };
  const value = JSON.stringify(rows.map((r) => ({ kind: r.kind, description: r.description.trim(), provider: r.provider.trim() || null, recovery_type: r.recovery_type || null, trips: r.kind === "recovery" ? Math.max(1, Math.round(num(r.trips) || 1)) : null, litres: r.kind === "fuel" ? num(r.litres) || null : null, cost_aed: num(r.cost), supplier_trn: r.trn.trim() || null, charge_aed: r.free ? 0 : num(r.charge), free: r.free, different_trip: r.kind === "recovery" && recoveryAlready.length > 0 && r.different })));
  return (
    <div className="flex flex-col gap-3" data-charge-editor>
      <input type="hidden" name={name} value={value} />
      {rows.map((r, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-control border border-line-strong bg-white p-3" data-charge-row={i}>
          <div className="flex flex-wrap items-center gap-1.5">
            {CHARGE_KINDS.map((k) => (
              <button key={k.key} type="button" onClick={() => set(i, { kind: k.key })} aria-pressed={r.kind === k.key} className={`min-h-11 rounded-control border px-4 text-sm font-bold ${r.kind === k.key ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-charge-kind={k.key}>{k.label}</button>
            ))}
            {rows.length > 1 ? <button type="button" onClick={() => setRows((p) => p.filter((_, j) => j !== i))} className="ml-auto min-h-11 px-3 text-sm font-bold text-red" aria-label="Remove this charge">Remove</button> : null}
          </div>
          {r.kind === "recovery" ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Provider
                <Input value={r.provider} onChange={(e) => set(i, { provider: e.target.value })} list={`charge-providers-${i}`} placeholder="Recovery company, or Our truck" className="w-60" textCase="upper" data-charge-provider />
                <datalist id={`charge-providers-${i}`}>{providers.map((p) => <option key={p} value={p} />)}</datalist>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Type
                <select value={r.recovery_type} onChange={(e) => pickType(i, e.target.value)} className="h-11 rounded-control border border-line-strong bg-white px-2 text-sm" data-charge-recovery-type>
                  <option value="">Pick…</option>
                  {recoveryTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Trips
                <Input value={r.trips} onChange={(e) => set(i, { trips: e.target.value })} inputMode="numeric" className="w-20" data-charge-trips />
              </label>
            </div>
          ) : r.kind === "fuel" ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Litres
                <Input value={r.litres} onChange={(e) => set(i, { litres: e.target.value })} inputMode="decimal" className="w-24" data-charge-litres />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Station or supplier
                <Input value={r.provider} onChange={(e) => set(i, { provider: e.target.value })} className="w-56" textCase="upper" />
              </label>
            </div>
          ) : (
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">What it is
              <Input value={r.description} onChange={(e) => set(i, { description: e.target.value })} placeholder="Parking, toll, towing extra…" className="w-full" textCase="upper" data-charge-description />
            </label>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Cost (we pay, AED)
              <Input value={r.cost} onChange={(e) => set(i, { cost: e.target.value })} inputMode="decimal" className="w-32" data-charge-cost />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Supplier TRN
              <Input value={r.trn} onChange={(e) => set(i, { trn: e.target.value })} inputMode="numeric" placeholder="If VAT registered" className="w-44" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Charge (customer pays, AED + VAT)
              <Input value={r.free ? "0" : r.charge} onChange={(e) => set(i, { charge: e.target.value })} inputMode="decimal" disabled={r.free} className="w-36" data-charge-charge />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={r.free} onChange={(e) => set(i, { free: e.target.checked })} className="h-5 w-5 accent-ink" data-charge-free />Free</label>
          </div>
          {r.free ? <p className="text-xs text-muted">Free follows the complimentary rule: the owner approves it (his own are approved at once).</p> : null}
          {r.kind === "recovery" && recoveryAlready.length ? (
            <div className="flex flex-col gap-2 rounded-control border border-amber-bar bg-amber-soft p-3 text-sm text-ink" data-charge-recovery-warning>
              <p className="font-bold">Recovery already on this car:</p>
              <ul className="flex flex-col gap-0.5">{recoveryAlready.map((w) => <li key={w} className="break-words" data-charge-recovery-already>{w}</li>)}</ul>
              <p>Adding another recovery charges the customer twice – unless it is a different trip.</p>
              <label className="flex min-h-11 items-center gap-2 font-semibold"><input type="checkbox" required checked={r.different} onChange={(e) => set(i, { different: e.target.checked })} className="h-5 w-5 shrink-0 accent-ink" data-charge-recovery-different />Yes, it is a different trip – add it</label>
            </div>
          ) : null}
        </div>
      ))}
      <button type="button" onClick={() => setRows((p) => [...p, blank("other")])} className="self-start min-h-11 rounded-control border border-dashed border-line-strong px-4 text-sm font-bold" data-charge-add-row>+ Another charge</button>
    </div>
  );
}

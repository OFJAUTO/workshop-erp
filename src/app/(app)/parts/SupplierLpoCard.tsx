"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";

export type SupplierLpoLine = { id: string; part_item_id: string; description: string; part_number: string | null; quantity: number; unit_cost: number; expected_date: string | null; received_qty: number };
export type SupplierLpo = { id: string; number: string; supplier_name: string; status: string; ordered_at: string | null; verify_token: string | null; total_cost_aed: number; lines: SupplierLpoLine[] };

/**
 * One supplier's LPO as a card: its number (LPO-00012-1), the parts with part number, name, quantity and our agreed
 * price, and three buttons. Copy: clean text for WhatsApp or email (the VIN, never the customer or our prices).
 * PDF: the supplier copy. Ordered: one tap, the arrival dates follow from the availability entered at pricing;
 * a part's date can be changed with a tap when the supplier says otherwise.
 */
export function SupplierLpoCard({ po, vin, canManage, onOrdered, onSetDate }: { po: SupplierLpo; vin: string | null; canManage: boolean; onOrdered: (formData: FormData) => void | Promise<void>; onSetDate: (partId: string, formData: FormData) => void | Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const ordered = po.status !== "approved" && po.status !== "pending_approval";
  const text = [
    `${po.number} · OFJ Automotive`,
    vin ? `VIN: ${vin}` : "",
    "",
    ...po.lines.map((l) => `• ${l.part_number ? `${l.part_number} · ` : ""}${l.description} × ${l.quantity}${l.unit_cost ? ` · AED ${l.unit_cost.toFixed(2)}` : ""}`),
    "",
    `Total before VAT: AED ${po.total_cost_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
  ].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
  const latest = po.lines.map((l) => l.expected_date).filter((d): d is string => !!d).sort().at(-1) ?? null;

  return (
    <div className="rounded-card border border-line bg-white p-4 flex flex-col gap-3" data-supplier-lpo={po.number}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-extrabold uppercase tracking-[0.04em]">{po.supplier_name} LPO</span>
        <span className="text-sm font-semibold text-muted">{po.number}</span>
        <span className={`ml-auto inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold ${ordered ? "bg-green-soft text-green" : "bg-chip text-muted"}`} data-lpo-state>
          {po.status === "received" ? "Received" : po.status === "partly_received" ? "Partly received" : ordered ? `Ordered ${po.ordered_at ? formatDateTime(po.ordered_at) : ""}` : "Approved, not ordered yet"}
        </span>
      </div>
      <ul className="divide-y divide-line text-sm">
        {po.lines.map((l) => (
          <li key={l.id} className="py-1.5 flex flex-wrap items-center gap-2" data-lpo-line>
            {l.part_number ? <span className="font-mono text-xs font-semibold">{l.part_number}</span> : null}
            <span className="font-semibold">{l.description}</span>
            <span className="text-muted">× {l.quantity} · AED {l.unit_cost.toFixed(2)}</span>
            {ordered ? (
              editing === l.part_item_id ? (
                <form action={(fd) => { setEditing(null); return onSetDate(l.part_item_id, fd); }} className="ml-auto inline-flex items-center gap-1">
                  <input type="date" name="date" defaultValue={l.expected_date ?? ""} required className="min-h-9 rounded-control border border-line-strong px-2 text-sm" aria-label="Expected date" />
                  <Button type="submit" size="md">Save</Button>
                  <Button type="button" tone="ghost" size="md" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : (
                <button type="button" disabled={!canManage} onClick={() => setEditing(l.part_item_id)} className={`ml-auto inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-bold ${l.received_qty >= l.quantity ? "bg-green-soft text-green" : "border border-line-strong bg-white"}`} title="Tap to change the date" data-part-date>
                  {l.received_qty >= l.quantity ? "Here" : l.expected_date ? `Expected ${formatDate(l.expected_date)}` : "No date"}
                </button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span className="text-sm font-semibold">AED {po.total_cost_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })} before VAT</span>
        {ordered && latest ? <span className="text-xs text-muted">· all here by {formatDate(latest)}</span> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" tone="secondary" size="md" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} }} data-lpo-copy>{copied ? "Copied" : "Copy"}</Button>
          {po.verify_token ? <a href={`/api/pdf/lpo/${po.verify_token}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-lpo-pdf>PDF</a> : null}
          {canManage && !ordered ? (
            <form action={onOrdered}>
              <Button type="submit" size="md" data-lpo-ordered>Ordered</Button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

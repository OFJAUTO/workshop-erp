"use client";

import { useState, useTransition } from "react";
import { positionsWords } from "@/lib/parts-list";
import { realPartNumber } from "@/lib/parts-rows";
import { PositionsLine } from "@/components/PositionsLine";
import { SharePdfButton } from "@/components/SharePdfButton";
import { Button } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";

export type SupplierLpoLine = { id: string; part_item_id: string; description: string; positions?: string[] | null; part_number: string | null; quantity: number; unit_cost: number; expected_date: string | null; received_qty: number };
/** A line whose part was given its ending (3 November 2026): cancelled (off the LPO), or returned / kept in stock (still on it). */
export type EndedLpoLine = { lineId: string; description: string; partNumber: string | null; quantity: number; unitCost: number; state: "cancelled" | "return_pending" | "returned" | "stock"; words: string; onLpo: boolean };
export type SupplierLpo = { id: string; number: string; supplier_name: string; status: string; ordered_at: string | null; verify_token: string | null; total_cost_aed: number; lines: SupplierLpoLine[]; /** Courier, freight: in the total already. */ charges?: { id: string; description: string; amount_aed: number }[]; sent_at?: string | null; emailed_at?: string | null; emailed_to?: string | null; ended?: EndedLpoLine[] };

/**
 * One supplier's LPO as a card: its number (LPO-00012-1), the parts with part number, name, quantity and our agreed
 * price, and the buttons. Copy: clean text for WhatsApp or email (the VIN, never the customer or our prices).
 * PDF and Share PDF: the supplier copy. Email to supplier: the PDF from the workshop mailbox to the supplier's email
 * on file ("Email not set up yet" until the owner connects it). Ordered: one tap, the arrival dates follow from the
 * availability entered at pricing; a part's date can be changed with a tap when the supplier says otherwise.
 */
export function SupplierLpoCard({ po, vin, canManage, onOrdered, onSetDate, onEmail, supplierEmail = null, emailReady = false, jobId = null }: { po: SupplierLpo; vin: string | null; canManage: boolean; onOrdered: (formData: FormData) => void | Promise<void>; onSetDate: (partId: string, formData: FormData) => void | Promise<void>; onEmail?: () => Promise<{ error?: string; message?: string }>; supplierEmail?: string | null; emailReady?: boolean; jobId?: string | null }) {
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [emailResult, setEmailResult] = useState<{ error?: string; message?: string } | null>(null);
  const [sending, startSend] = useTransition();
  const cancelledPo = po.status === "cancelled";
  const ordered = po.status !== "approved" && po.status !== "pending_approval" && !cancelledPo;
  // Lines whose part was given its ending: a cancelled one is off the LPO (shown greyed), a returned or kept one is
  // still on it (delivered and invoiced) with what happened to it.
  const endedOf = new Map((po.ended ?? []).filter((e) => e.onLpo).map((e) => [e.lineId, e]));
  const cancelledLines = (po.ended ?? []).filter((e) => !e.onLpo);
  const returns = (po.ended ?? []).filter((e) => e.onLpo && (e.state === "return_pending" || e.state === "returned"));
  const returnsAed = returns.reduce((a, e) => a + e.quantity * e.unitCost, 0);
  const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const text = cancelledPo
    ? [`${po.number} · OFJ Automotive`, vin ? `VIN: ${vin}` : "", "", "Please cancel:", ...cancelledLines.map((l) => `• ${l.partNumber ? `${l.partNumber} · ` : ""}${l.description} × ${l.quantity}`)].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n")
    : [
        `${po.number} · OFJ Automotive`,
        vin ? `VIN: ${vin}` : "",
        "",
        ...po.lines.map((l) => `• ${realPartNumber(l.part_number) ? `${realPartNumber(l.part_number)} · ` : ""}${l.description}${positionsWords(l.positions) ? ` · ${positionsWords(l.positions)}` : ""} × ${l.quantity}${l.unit_cost ? ` · AED ${l.unit_cost.toFixed(2)}` : ""}`),
        ...(po.charges ?? []).map((c) => `• ${c.description} · AED ${c.amount_aed.toFixed(2)}`),
        ...(cancelledLines.length ? ["", "Cancelled:", ...cancelledLines.map((l) => `• ${l.partNumber ? `${l.partNumber} · ` : ""}${l.description} × ${l.quantity}`)] : []),
        "",
        `Total before VAT: AED ${po.total_cost_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
      ].filter((x, i, a) => !(x === "" && a[i - 1] === "")).join("\n");
  const latest = po.lines.map((l) => l.expected_date).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const sentLine = po.emailed_at ? `Sent to supplier by email ${formatDateTime(po.emailed_at)}${po.emailed_to ? ` (${po.emailed_to})` : ""}` : po.sent_at ? `Sent to supplier ${formatDateTime(po.sent_at)}` : null;

  return (
    <div className={`rounded-card border-2 p-4 flex flex-col gap-3 ${cancelledPo ? "border-line bg-canvas" : ordered ? "border-green bg-green-soft" : "border-ink bg-white"}`} data-supplier-lpo={po.number} data-ordered={ordered ? "1" : "0"} data-lpo-status={po.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-base font-extrabold uppercase tracking-[0.04em] ${cancelledPo ? "text-muted" : ""}`}>{po.supplier_name} LPO</span>
        <span className="text-sm font-semibold text-muted">{po.number}</span>
        <span className={`ml-auto inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold ${ordered ? "bg-green-soft text-green" : "bg-chip text-muted"}`} data-lpo-state>
          {cancelledPo ? "Cancelled – no part left on it" : po.status === "received" ? "Received ✓" : po.status === "partly_received" ? "Partly received" : ordered ? `Ordered ✓ ${po.ordered_at ? formatDateTime(po.ordered_at) : ""}` : "Approved, not ordered yet"}
        </span>
      </div>
      {sentLine ? <span className="text-xs font-semibold text-green" data-lpo-sent>{sentLine}</span> : null}
      <ul className="divide-y divide-line text-sm">
        {po.lines.map((l) => endedOf.get(l.id) ? (
          <li key={l.id} className="py-1.5 flex flex-wrap items-center gap-2 opacity-70" data-lpo-line data-lpo-line-ended={endedOf.get(l.id)!.state}>
            {realPartNumber(l.part_number) ? <span className="font-mono text-xs font-semibold">{realPartNumber(l.part_number)}</span> : null}
            <span className="flex flex-col"><span className="font-semibold">{l.description}</span><PositionsLine positions={l.positions} /></span>
            <span className="text-muted">× {l.quantity} · AED {l.unit_cost.toFixed(2)}</span>
            <span className={`ml-auto inline-flex min-h-6 items-center rounded-full border px-2.5 text-[11px] font-bold ${endedOf.get(l.id)!.state === "return_pending" ? "border-amber-bar bg-amber-soft text-amber" : "border-line-strong bg-white text-ink"}`}>{endedOf.get(l.id)!.words}</span>
          </li>
        ) : (
          <li key={l.id} className={`py-1.5 flex flex-wrap items-center gap-2 ${l.received_qty >= l.quantity ? "rounded-control bg-green-soft px-2 text-green" : ""}`} data-lpo-line data-line-received={l.received_qty >= l.quantity ? "1" : "0"}>
            {realPartNumber(l.part_number) ? <span className="font-mono text-xs font-semibold">{realPartNumber(l.part_number)}</span> : null}
            <span className="flex flex-col"><span className="font-semibold">{l.description}</span><PositionsLine positions={l.positions} /></span>
            <span className="text-muted">× {l.quantity} · AED {l.unit_cost.toFixed(2)}</span>
            {ordered ? (
              editing === l.part_item_id ? (
                <form action={(fd) => { setEditing(null); return onSetDate(l.part_item_id, fd); }} className="ml-auto inline-flex items-center gap-1">
                  <input type="date" name="date" defaultValue={l.expected_date ?? ""} required className="min-h-9 rounded-control border border-line-strong px-2 text-sm" aria-label="Expected date" />
                  <Button type="submit" size="md">Save</Button>
                  <Button type="button" tone="ghost" size="md" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              ) : (
                <button type="button" disabled={!canManage} onClick={() => setEditing(l.part_item_id)} data-part-date className={`ml-auto inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-bold ${l.received_qty >= l.quantity ? "bg-green-soft text-green" : "border border-line-strong bg-white"}`}>
                  {l.received_qty >= l.quantity ? "Here" : l.expected_date ? `Expected ${formatDate(l.expected_date)}` : "No date"}
                </button>
              )
            ) : null}
          </li>
        ))}
        {(po.charges ?? []).map((c) => (
          <li key={c.id} className="py-1.5 flex flex-wrap items-center gap-2" data-lpo-charge>
            <span className="inline-flex h-5 items-center rounded-full bg-chip px-2 text-[10px] font-bold text-muted">Other charge</span>
            <span className="font-semibold">{c.description}</span>
            <span className="text-muted">AED {c.amount_aed.toFixed(2)}</span>
          </li>
        ))}
        {cancelledLines.map((l) => (
          <li key={l.lineId} className="py-1.5 flex flex-wrap items-center gap-2 text-muted" data-lpo-line-cancelled={l.lineId}>
            {l.partNumber ? <span className="font-mono text-xs font-semibold line-through">{l.partNumber}</span> : null}
            <span className="font-semibold line-through">{l.description}</span>
            <span className="line-through">× {l.quantity} · AED {l.unitCost.toFixed(2)}</span>
            <span className="ml-auto inline-flex min-h-6 items-center rounded-full border border-line-strong bg-white px-2.5 text-[11px] font-bold text-ink">{l.words}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span className="text-sm font-semibold" data-lpo-total>AED {po.total_cost_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })} before VAT{cancelledLines.length ? ` · ${cancelledLines.length} line${cancelledLines.length === 1 ? "" : "s"} cancelled` : ""}</span>
        {returnsAed > 0 ? <span className="text-xs font-semibold text-amber" data-lpo-returns>Returns −AED {money(returnsAed)} (supplier credit) · net AED {money(Math.max(0, po.total_cost_aed - returnsAed))}</span> : null}
        {ordered && latest ? <span className="text-xs text-muted">· all here by {formatDate(latest)}</span> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" tone="secondary" size="md" onClick={async () => { try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {} }} data-lpo-copy>{copied ? "Copied" : "Copy"}</Button>
          {po.verify_token ? <a href={`/api/pdf/lpo/${po.verify_token}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-lpo-pdf>PDF</a> : null}
          {po.verify_token ? <SharePdfButton href={`/api/pdf/lpo/${po.verify_token}`} fileName={`OFJ LPO ${po.number}.pdf`} jobId={jobId} kind="lpo" /> : null}
          {canManage && onEmail && po.verify_token && !cancelledPo ? (
            <Button type="button" tone="secondary" size="md" disabled={sending} onClick={() => startSend(async () => { setEmailResult(null); setEmailResult(await onEmail()); })} data-lpo-email>
              {sending ? "Sending…" : po.emailed_at ? "Email to supplier again" : "Email to supplier"}
            </Button>
          ) : null}
          {canManage && !ordered && !cancelledPo ? (
            <form action={onOrdered}>
              <Button type="submit" size="md" data-lpo-ordered>Ordered</Button>
            </form>
          ) : null}
        </div>
      </div>
      {canManage && onEmail && !emailReady && !emailResult ? <span className="text-xs text-muted" data-lpo-email-note>Email not set up yet: the owner connects the Google Workspace mailbox in Vercel. Share PDF and Copy work meanwhile.</span> : null}
      {canManage && onEmail && emailReady && !supplierEmail && !emailResult ? <span className="text-xs text-muted" data-lpo-email-note>No email on {po.supplier_name} yet: add it under Suppliers to email the LPO.</span> : null}
      {emailResult ? <span className={`text-xs font-semibold ${emailResult.error ? "text-red" : "text-green"}`} data-lpo-email-result>{emailResult.error ?? emailResult.message}</span> : null}
    </div>
  );
}

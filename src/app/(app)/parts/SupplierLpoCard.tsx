"use client";

import { useState, useTransition } from "react";
import { SharePdfButton } from "@/components/SharePdfButton";
import { Button } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";

export type SupplierLpoLine = { id: string; part_item_id: string; description: string; part_number: string | null; quantity: number; unit_cost: number; expected_date: string | null; received_qty: number };
export type SupplierLpo = { id: string; number: string; supplier_name: string; status: string; ordered_at: string | null; verify_token: string | null; total_cost_aed: number; lines: SupplierLpoLine[]; sent_at?: string | null; emailed_at?: string | null; emailed_to?: string | null };

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
  const sentLine = po.emailed_at ? `Sent to supplier by email ${formatDateTime(po.emailed_at)}${po.emailed_to ? ` (${po.emailed_to})` : ""}` : po.sent_at ? `Sent to supplier ${formatDateTime(po.sent_at)}` : null;

  return (
    <div className={`rounded-card border-2 p-4 flex flex-col gap-3 ${ordered ? "border-green bg-green-soft" : "border-ink bg-white"}`} data-supplier-lpo={po.number} data-ordered={ordered ? "1" : "0"}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-extrabold uppercase tracking-[0.04em]">{po.supplier_name} LPO</span>
        <span className="text-sm font-semibold text-muted">{po.number}</span>
        <span className={`ml-auto inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-bold ${ordered ? "bg-green-soft text-green" : "bg-chip text-muted"}`} data-lpo-state>
          {po.status === "received" ? "Received ✓" : po.status === "partly_received" ? "Partly received" : ordered ? `Ordered ✓ ${po.ordered_at ? formatDateTime(po.ordered_at) : ""}` : "Approved, not ordered yet"}
        </span>
      </div>
      {sentLine ? <span className="text-xs font-semibold text-green" data-lpo-sent>{sentLine}</span> : null}
      <ul className="divide-y divide-line text-sm">
        {po.lines.map((l) => (
          <li key={l.id} className={`py-1.5 flex flex-wrap items-center gap-2 ${l.received_qty >= l.quantity ? "rounded-control bg-green-soft px-2 text-green" : ""}`} data-lpo-line data-line-received={l.received_qty >= l.quantity ? "1" : "0"}>
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
                <button type="button" disabled={!canManage} onClick={() => setEditing(l.part_item_id)} data-part-date className={`ml-auto inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-bold ${l.received_qty >= l.quantity ? "bg-green-soft text-green" : "border border-line-strong bg-white"}`}>
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
          {po.verify_token ? <SharePdfButton href={`/api/pdf/lpo/${po.verify_token}`} fileName={`OFJ LPO ${po.number}.pdf`} jobId={jobId} kind="lpo" /> : null}
          {canManage && onEmail && po.verify_token ? (
            <Button type="button" tone="secondary" size="md" disabled={sending} onClick={() => startSend(async () => { setEmailResult(null); setEmailResult(await onEmail()); })} data-lpo-email>
              {sending ? "Sending…" : po.emailed_at ? "Email to supplier again" : "Email to supplier"}
            </Button>
          ) : null}
          {canManage && !ordered ? (
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

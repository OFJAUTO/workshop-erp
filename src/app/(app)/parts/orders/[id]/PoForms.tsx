"use client";

import { useState } from "react";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { Button, Input, Select, Textarea } from "@/components/ui";

type Line = { id: string; description: string; part_number: string | null; quantity: number; received_qty: number; unit_cost: number; flag: string | null };

/** Receiving: a quantity per line, partial allowed, wrong or damaged flagged for return. */
export function ReceiveForm({ lines, action }: { lines: Line[]; action: (formData: FormData) => void }) {
  const [flags, setFlags] = useState<Record<string, string>>({});
  return (
    <form action={action} className="flex flex-col gap-3">
      <ul className="divide-y divide-line">
        {lines.map((l) => {
          const left = Math.max(0, l.quantity - l.received_qty);
          return (
            <li key={l.id} className="py-3 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-48">
                <p className="font-semibold">{l.description}</p>
                <p className="text-xs text-muted">{l.part_number ?? "no part number"} · ordered {l.quantity}, received {l.received_qty}{left ? `, ${left} to come` : " (complete)"}</p>
              </div>
              {left > 0 ? (
                <>
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Received now</span><Input name={`received__${l.id}`} defaultValue={String(left)} inputMode="decimal" className="w-24" /></label>
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Condition</span>
                    <Select name={`flag__${l.id}`} value={flags[l.id] ?? ""} onChange={(e) => setFlags({ ...flags, [l.id]: e.target.value })} className="w-40">
                      <option value="">Correct</option>
                      <option value="wrong">Wrong part</option>
                      <option value="damaged">Damaged</option>
                    </Select>
                  </label>
                  {flags[l.id] ? <label className="flex flex-col gap-1 flex-1 min-w-48"><span className="text-xs font-semibold text-muted">Note for the return</span><Input name={`flag_note__${l.id}`} /></label> : null}
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div><Button type="submit" size="md">Record the delivery</Button></div>
    </form>
  );
}

/** The supplier invoice: number plus a scan (phone camera or PC upload), or "Invoice to follow". Prices per line correct the job cost when they differ. */
export function SupplierInvoiceForm({ jobId, poId, lines, action }: { jobId: string; poId: string; lines: Line[]; action: (formData: FormData) => void }) {
  const [toFollow, setToFollow] = useState(false);
  const [scan, setScan] = useState<JobFile | null>(null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" name="to_follow" checked={toFollow} onChange={(e) => setToFollow(e.target.checked)} className="h-5 w-5 accent-ink" />
        Invoice to follow (no invoice from the supplier yet)
      </label>
      {!toFollow ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Supplier invoice number</span><Input name="invoice_number" required={!toFollow} /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Invoice total before VAT (optional)</span><Input name="amount" inputMode="decimal" /></label>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Scan of the invoice (required)</span>
            <JobFileUpload jobId={jobId} kind="supplier_invoice" refId={poId} files={scan ? [scan] : []} accept="pdf" label="Photo or PDF of the invoice" onAdded={(f) => setScan(f)} />
            <input type="hidden" name="scan_path" value={scan?.path ?? ""} />
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-muted">Prices on the invoice, if different from the order</summary>
            <ul className="mt-2 divide-y divide-line">
              {lines.map((l) => (
                <li key={l.id} className="py-2 flex flex-wrap items-center gap-3">
                  <span className="flex-1 min-w-48 font-semibold">{l.description} <span className="text-muted font-normal">· PO {l.unit_cost.toFixed(2)} each</span></span>
                  <Input name={`price__${l.id}`} inputMode="decimal" placeholder="invoice price each" className="w-40" />
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : null}
      <div><Button type="submit" size="md">{toFollow ? "Note: invoice to follow" : "Save the supplier invoice"}</Button></div>
    </form>
  );
}

/** Expected delivery date per line when the order is placed. */
/** Tomorrow's date, kept outside the component so the render stays free of clock calls. */
function tomorrowIso() {
  return new Date(Date.now() + 86400000).toISOString().slice(0, 10);
}

export function OrderedForm({ lines, action }: { lines: Line[]; action: (formData: FormData) => void }) {
  const tomorrow = tomorrowIso();
  return (
    <form action={action} className="flex flex-col gap-3">
      <ul className="divide-y divide-line">
        {lines.map((l) => (
          <li key={l.id} className="py-2 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-48 font-semibold">{l.description} <span className="text-muted font-normal">× {l.quantity}</span></span>
            <label className="flex items-center gap-2 text-xs font-semibold text-muted">Expected <Input name={`expected__${l.id}`} type="date" defaultValue={tomorrow} className="w-44" required /></label>
          </li>
        ))}
      </ul>
      <div><Button type="submit" size="md">Mark ordered</Button></div>
    </form>
  );
}

/** The owner's approval with the deposit override box when needed. */
export function DecideForm({ action, depositShort, isOwner }: { action: (formData: FormData) => void; depositShort: string | null; isOwner: boolean }) {
  return (
    <form action={action} className="flex flex-col gap-2">
      {depositShort ? <p className="text-sm font-semibold text-red">{depositShort}</p> : null}
      {depositShort && isOwner ? <Textarea name="override_reason" rows={2} placeholder="Reason to approve without the deposit (logged)" /> : null}
      <Textarea name="note" rows={2} placeholder="Note to Parts (optional)" />
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="approve" size="md" disabled={!!depositShort && !isOwner}>Approve</Button>
        <Button type="submit" name="decision" value="refuse" tone="secondary" size="md">Refuse</Button>
      </div>
    </form>
  );
}

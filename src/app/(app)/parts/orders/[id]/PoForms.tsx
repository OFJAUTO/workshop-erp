"use client";

import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { ReasonChips } from "@/components/ReasonChips";

import { useState } from "react";
import { SupplierInvoiceBox } from "@/components/SupplierInvoiceBox";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { realPartNumber } from "@/lib/parts-rows";

type Line = { id: string; description: string; part_number: string | null; quantity: number; received_qty: number; unit_cost: number; flag: string | null; invoice_check?: string | null };

/** The per-line invoice prices (a difference over AED 1 is flagged for Accept / Dispute). */
export function LinePrices({ lines, word }: { lines: Pick<Line, "id" | "description" | "unit_cost">[]; word: string }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer min-h-11 flex items-center font-semibold text-muted">Prices on the invoice, if different from the {word} (more than AED 1 off is flagged)</summary>
      <ul className="mt-2 divide-y divide-line">
        {lines.map((l) => (
          <li key={l.id} className="py-2 flex flex-wrap items-center gap-3">
            <span className="flex-1 min-w-48 font-semibold">{l.description} <span className="text-muted font-normal">· {word} {l.unit_cost.toFixed(2)} each</span></span>
            <Input name={`price__${l.id}`} inputMode="decimal" placeholder="invoice price each" className="w-40" data-invoice-price={l.id} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Receiving: a quantity per line, partial allowed, wrong or damaged flagged for return. The invoice is NEVER entered here (4 November 2026: accounts collect the paper and scan it). */
export function ReceiveForm({ lines, action, invoiceOpen = false }: { lines: Line[]; action: (formData: FormData) => void; /** The LPO's invoice is still to come: the note under the form says accounts take it over. */ invoiceOpen?: boolean }) {
  const [flags, setFlags] = useState<Record<string, string>>({});
  return (
    <form action={action} className="flex flex-col gap-3" data-receive-form>
      <ul className="divide-y divide-line">
        {lines.map((l) => {
          const left = Math.max(0, l.quantity - l.received_qty);
          return (
            <li key={l.id} className="py-3 flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-48">
                <p className="font-semibold">{l.description}</p>
                <p className="text-xs text-muted">{realPartNumber(l.part_number) ?? "no part number"} · ordered {l.quantity}, received {l.received_qty}{left ? `, ${left} to come` : " (complete)"}</p>
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
      {invoiceOpen ? <p className="text-xs text-muted" data-receive-invoice-note>The supplier&apos;s invoice is NOT entered here: keep the paper at the desk – accounts collect and scan it (they are told the moment you save).</p> : null}
      <div><Button type="submit" size="md" data-record-delivery>Record the delivery</Button></div>
    </form>
  );
}

/** The supplier invoice entered on its own, after the delivery: the same ONE box. */
export function SupplierInvoiceForm({ jobId, poId, lines, action, poTotal = null }: { jobId: string | null; poId: string; lines: Line[]; action: (formData: FormData) => void; poTotal?: number | null }) {
  return (
    <form action={action} className="flex flex-col gap-3">
      <SupplierInvoiceBox jobId={jobId} poId={poId} poTotal={poTotal} />
      <LinePrices lines={lines} word="PO" />
      <div><Button type="submit" size="md" data-save-invoice>Save the supplier invoice</Button></div>
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
export function DecideForm({ action, depositShort, isOwner, reasons = [], summary = [], problems = [], problemAdvice = "" }: { action: (formData: FormData) => void; depositShort: string | null; isOwner: boolean; /** One-tap reasons to approve without the deposit (Settings). */ reasons?: string[]; /** What the approval commits to ("LPO-00038 · 2 suppliers · AED 5,651.00"), shown in the confirmation (B3). */ summary?: string[]; /** Lines with no real price (2 November 2026): Approve stays off until they are fixed or refused. */ problems?: string[]; problemAdvice?: string }) {
  return (
    <form action={action} className="flex flex-col gap-2">
      {problems.length ? (
        <div className="flex flex-col gap-1 rounded-control border-2 border-red-bar bg-white px-3 py-2" data-lpo-problems={problems.length}>
          <span className="text-sm font-bold text-red">Approve is off: {problems.length} line{problems.length === 1 ? " has" : "s have"} no real price yet.</span>
          <ul className="list-disc pl-5 text-sm text-red">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          {problemAdvice ? <span className="text-xs text-muted">{problemAdvice}</span> : null}
        </div>
      ) : null}
      {depositShort ? <p className="text-sm font-semibold text-red" data-deposit-short>{depositShort}</p> : null}
      {depositShort && !isOwner ? <p className="text-xs text-muted">Only the owner can approve without the deposit.</p> : null}
      {depositShort && isOwner ? <p className="text-xs text-muted">Approving now is an override: tap a reason, it is written on the job.</p> : null}
      {depositShort && isOwner ? <ReasonChips name="override_reason" rows={2} options={reasons} placeholder="Reason to approve without the deposit (logged)" /> : null}
      <Textarea name="note" rows={2} placeholder="Note to Parts (optional)" />
      <div className="flex gap-2">
        <ConfirmSubmit label="Approve" title="Approve this LPO?" lines={["Approve", ...summary, depositShort && isOwner ? "without the deposit (override)" : ""].filter(Boolean)} live={depositShort && isOwner ? [{ label: "reason:", field: "override_reason" }] : []} confirmLabel="Yes, approve the LPO" name="decision" value="approve" size="md" disabled={(!!depositShort && !isOwner) || problems.length > 0} hook="lpo-approve" />
        <Button type="submit" name="decision" value="refuse" tone="secondary" size="md">Refuse</Button>
      </div>
    </form>
  );
}

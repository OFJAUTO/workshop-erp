"use client";

import { useState } from "react";
import { Button, Input, Textarea } from "./ui";
import { dubaiToday, invoiceNumberLooksReal } from "@/lib/supplier-invoice";

/**
 * EDIT an entered supplier invoice (5 November 2026, the Gargash case LPO-00037-2): the owner and accounts
 * change the number, date, per-line costs, the before-VAT amount and the VAT - with a COMPULSORY remark.
 * One shared button + form, used in the LPO page's Record box and on the opened invoice in Supplier
 * invoices. The server (editSupplierInvoice) records who, when and old → new; `InvoiceEditHistory` below
 * shows that record. The customer's price never changes from here.
 */

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n: number) => Math.round(n * 100) / 100;

export type EditInvoiceLine = { id: string; description: string; quantity: number; price: number };

export function SupplierInvoiceEditButton({
  action,
  back,
  poNumber,
  number,
  date,
  amount,
  vat,
  lpoTotal,
  lines,
  paid,
  label = "Edit invoice",
  chargesVat = true,
}: {
  action: (formData: FormData) => void | Promise<void>;
  /** Where the answer lands (the page this button sits on). */
  back: string;
  poNumber: string;
  number: string;
  date: string;
  /** The entered before-VAT amount (null = none typed; the LPO total stands in). */
  amount: number | null;
  /** The effective VAT today (typed, else 5% of the amount). */
  vat: number | null;
  /** The LPO's approved before-VAT total ("Approved X → Invoiced Y"). */
  lpoTotal: number;
  lines: EditInvoiceLine[];
  paid: boolean;
  label?: string;
  /** THE supplier VAT rule (5 November 2026): false = the supplier is not VAT registered (no TRN): no VAT expected. */
  chargesVat?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [num, setNum] = useState(number);
  const [day, setDay] = useState(date);
  const [amt, setAmt] = useState(amount === null ? "" : amount.toFixed(2));
  const [vatText, setVatText] = useState(vat === null ? "" : vat.toFixed(2));
  const [confirmed, setConfirmed] = useState(false);

  const amountNum = Number(amt.replace(/[^\d.]/g, "")) || 0;
  const fivePct = chargesVat ? r2(amountNum * 0.05) : 0;
  const vatNum = vatText.trim() === "" ? fivePct : Number(vatText.replace(/[^\d.]/g, "")) || 0;
  // Suppliers round VAT per line: allow a fil per line before warning (and the warning never blocks).
  const vatTolerance = Math.max(0.01, 0.01 * Math.max(1, lines.length));
  const vatOff = amountNum > 0 && Math.abs(vatNum - fivePct) > vatTolerance + 0.0001;
  const total = r2(amountNum + vatNum);
  const diff = r2(amountNum - lpoTotal);
  const amountOff = amountNum > 0 && lpoTotal > 0 && Math.abs(amountNum - lpoTotal) / lpoTotal > 0.05;
  const numberBad = num.trim().length > 0 && !invoiceNumberLooksReal(num);

  return (
    <>
      {!open ? (
        <Button type="button" tone="secondary" size="md" onClick={() => setOpen(true)} data-si-edit>
          {label}
        </Button>
      ) : null}
      {/* The form is in the page from the server render (hidden while closed), so it posts even without JavaScript. */}
      <form action={action} hidden={!open} className="flex flex-col gap-3 rounded-control border border-ink bg-canvas p-3" data-si-edit-form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-[0.08em]">Edit the supplier invoice · {poNumber}</span>
        <Button type="button" tone="ghost" size="md" onClick={() => setOpen(false)} data-si-edit-close>Close</Button>
      </div>
      <input type="hidden" name="back" value={back} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Invoice number</span>
          <Input name="invoice_number" value={num} onChange={(e) => setNum(e.target.value)} required data-edit-number />
          {numberBad ? <span className="text-xs font-semibold text-red">That doesn&apos;t look like a real invoice number.</span> : null}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Date on the invoice</span>
          <Input name="invoice_date" type="date" value={day} onChange={(e) => setDay(e.target.value)} max={dubaiToday()} required data-edit-date />
        </label>
      </div>
      {lines.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Cost before VAT, each (from the supplier&apos;s invoice)</span>
          <ul className="divide-y divide-line">
            {lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm" data-edit-line={l.id}>
                <span className="min-w-0 flex-1 font-semibold uppercase">{l.description}</span>
                <span className="text-muted">× {l.quantity}</span>
                <Input name={`price__${l.id}`} defaultValue={l.price ? l.price.toFixed(2) : ""} inputMode="decimal" className="!w-28 text-right" aria-label={`Invoice price for ${l.description}`} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Total before VAT</span>
          <Input name="invoice_amount" value={amt} onChange={(e) => { setAmt(e.target.value); setConfirmed(false); }} inputMode="decimal" data-edit-amount />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">VAT on the invoice (empty = 5%)</span>
          <Input name="invoice_vat" value={vatText} onChange={(e) => setVatText(e.target.value)} inputMode="decimal" data-edit-vat />
        </label>
      </div>
      {vatOff ? (
        <p className="rounded-control border border-amber-bar bg-amber-soft px-3 py-2 text-sm font-semibold" data-vat-warning>
          {chargesVat ? <>VAT typed is not 5% of the amount (5% = AED {money(fivePct)}). Suppliers round per line – you can still save.</> : <>This supplier is not VAT-registered (no TRN on file): VAT is not counted for it. If the invoice really shows VAT, add the supplier&apos;s TRN on Parts &gt; Suppliers first.</>}
        </p>
      ) : null}
      <p className="text-sm font-bold" data-edit-total>Total with VAT: AED {money(total)}</p>
      {Math.abs(diff) > 0.005 && amountNum > 0 ? (
        <p className="text-sm font-semibold" data-invoice-vs-approved>
          Approved {money(lpoTotal)} → Invoiced {money(amountNum)} ({diff < 0 ? "−" : "+"}{money(Math.abs(diff))})
        </p>
      ) : null}
      {amountOff ? (
        <label className="flex items-start gap-2 rounded-control border border-amber-bar bg-amber-soft px-3 py-2 text-sm font-semibold" data-edit-amount-check>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-5 w-5 accent-ink" />
          <span>Invoice AED {money(amountNum)} vs order AED {money(lpoTotal)} – check the figure. Tick if the amount is right.</span>
        </label>
      ) : null}
      <input type="hidden" name="amount_confirmed" value={confirmed ? "on" : ""} />
      {paid ? (
        <p className="rounded-control border border-amber-bar bg-amber-soft px-3 py-2 text-sm font-semibold" data-edit-paid-note>
          This LPO is already paid. The recorded payment will NOT change – any difference is shown as owed to or by the supplier.
        </p>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-muted">Why is it being changed? (compulsory – kept on the record)</span>
        <Textarea name="edit_remark" required minLength={5} rows={2} placeholder="e.g. supplier&apos;s final invoice is less than the quote" textCase="sentence" data-edit-remark />
      </label>
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <Button type="submit" size="lg" data-edit-save>Save the edit</Button>
        <span className="text-xs text-muted">Who, when and old → new are recorded. The invoice goes back to UNCHECKED for accounts.</span>
      </div>
      </form>
    </>
  );
}

export type InvoiceEditEntry = { id: string; at: string; by: string; remark: string; changes: { field: string; old: string; new: string }[]; paidDiff: number | null };

/** The record of every edit: who, when, the remark and each old → new. Rendered wherever the invoice shows. */
export function InvoiceEditHistory({ entries }: { entries: InvoiceEditEntry[] }) {
  if (!entries.length) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-2" data-invoice-edit-history>
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Invoice edits</span>
      {entries.map((e) => (
        <div key={e.id} className="flex flex-col gap-0.5 text-sm" data-invoice-edit={e.id}>
          <span className="font-semibold">{e.at}{e.by ? ` · ${e.by}` : ""} — {e.remark}</span>
          {e.changes.map((c, i) => (
            <span key={i} className="text-muted" data-edit-change>{c.field}: {c.old || "—"} → {c.new || "—"}</span>
          ))}
          {e.paidDiff !== null ? (
            <span className="font-semibold text-amber-bar" data-edit-paid-diff>
              {e.paidDiff < 0 ? `Paid before the edit: the supplier owes us AED ${money(Math.abs(e.paidDiff))}` : `Paid before the edit: the supplier is owed AED ${money(e.paidDiff)} more`}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

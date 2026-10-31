"use client";

import { useState } from "react";
import { JobFileUpload, type FilesWaiting, type JobFile } from "./JobFileUpload";
import { Input } from "./ui";
import { checkSupplierInvoice, dubaiToday, invoiceNumberLooksReal } from "@/lib/supplier-invoice";

/**
 * THE supplier-invoice box (2.5, 21 October 2026): one component wherever an invoice is entered - the
 * receiving panel, the LPO's receive form and its own invoice card. Number and date compulsory unless
 * "Invoice to follow"; the amount cross-checked against the LPO total (more than 5% off must be
 * confirmed); photos or PDFs, several, with thumbnails and an X; the number is checked for
 * keyboard-mash and the date cannot be in the future. It renders FIELDS ONLY and lives inside the
 * caller's form: invoice_number, invoice_date, invoice_amount, to_follow, amount_confirmed, scan_path.
 * The scans go through the send queue (31 October 2026): scan_path is filled only once the server has the file.
 */
export function SupplierInvoiceBox({
  jobId,
  poId,
  poTotal,
  clientKey,
  canFollow = true,
  formTag,
  onWaiting,
}: {
  jobId: string | null;
  poId: string | null;
  poTotal: number | null;
  /** Ties the uploaded files to this save when the LPO is not known yet (the receiving panel). */
  clientKey?: string | null;
  canFollow?: boolean;
  /** The form the key belongs to (useFormKey): scans it already sent come back after a reload. */
  formTag?: string;
  /** Scans still on their way: the caller's save waits for them. */
  onWaiting?: (w: FilesWaiting) => void;
}) {
  const [toFollow, setToFollow] = useState(false);
  const [number, setNumber] = useState("");
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  // The scans are tied to the LPO, else to the save's key; the list follows that reference (a new one starts empty).
  const ref = poId ?? clientKey ?? null;
  const [fileState, setFileState] = useState<{ ref: string | null; files: JobFile[] }>({ ref, files: [] });
  if (fileState.ref !== ref) setFileState({ ref, files: [] });
  const files = fileState.ref === ref ? fileState.files : [];
  const amountNum = Number(amount.replace(/[^\d.]/g, "")) || null;
  const check = checkSupplierInvoice({ toFollow, number: number || null, date: date || null, amount: amountNum, poTotal, amountConfirmed: confirmed, today: dubaiToday() });
  const amountOff = !toFollow && amountNum !== null && amountNum > 0 && poTotal !== null && poTotal > 0 && Math.abs(amountNum - poTotal) / poTotal > 0.05;
  const numberBad = !toFollow && number.trim().length > 0 && !invoiceNumberLooksReal(number);
  const dateBad = !toFollow && date !== "" && date > dubaiToday();

  return (
    <div className="flex flex-col gap-2 rounded-control border border-line bg-canvas p-3" data-supplier-invoice-box>
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Supplier invoice</span>
      {canFollow ? (
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" name="to_follow" checked={toFollow} onChange={(e) => setToFollow(e.target.checked)} className="h-5 w-5 accent-ink" data-to-follow />
          Invoice to follow (no invoice from the supplier yet)
        </label>
      ) : null}
      {!toFollow ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Invoice number</span>
              <Input name="invoice_number" value={number} onChange={(e) => setNumber(e.target.value)} required data-invoice-number />
              {numberBad ? <span className="text-[11px] font-semibold text-red" data-number-bad>That doesn&apos;t look like a real invoice number.</span> : null}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Date on the invoice</span>
              <Input name="invoice_date" type="date" value={date} onChange={(e) => setDate(e.target.value)} max={dubaiToday()} required data-invoice-date />
              {dateBad ? <span className="text-[11px] font-semibold text-red" data-date-bad>The invoice date cannot be in the future.</span> : null}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Total before VAT (optional)</span>
              <Input name="invoice_amount" value={amount} onChange={(e) => { setAmount(e.target.value); setConfirmed(false); }} inputMode="decimal" data-invoice-amount />
            </label>
          </div>
          {amountOff ? (
            <label className="flex items-start gap-2 rounded-control border border-amber-bar bg-amber-soft px-3 py-2 text-sm font-semibold" data-amount-check>
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5 h-5 w-5 accent-ink" data-amount-confirm />
              <span>Invoice AED {amountNum?.toLocaleString("en-GB")} vs order AED {poTotal?.toLocaleString("en-GB")} – check the figure. Tick if the amount is right.</span>
            </label>
          ) : null}
          <input type="hidden" name="amount_confirmed" value={confirmed ? "on" : ""} />
          {jobId ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Photo or PDF of the invoice (several pages are fine; needed before the supplier is paid)</span>
              {ref ? (
                <JobFileUpload
                  jobId={jobId}
                  kind="supplier_invoice"
                  refId={ref}
                  form={formTag && clientKey ? { tag: formTag, key: clientKey } : null}
                  files={files}
                  accept="pdf"
                  label="Take photo / attach"
                  compact
                  removable
                  onAdded={(f) => setFileState((s) => (f.refId === s.ref && !s.files.some((x) => x.id === f.id) ? { ...s, files: [...s.files, f] } : s))}
                  onRemoved={(f) => setFileState((s) => ({ ...s, files: s.files.filter((x) => x.id !== f.id) }))}
                  onPending={onWaiting}
                />
              ) : null}
              <input type="hidden" name="scan_path" value={files[0]?.path ?? ""} />
            </div>
          ) : null}
          {!check.ok && (number || date || amountOff) ? <span className="text-xs font-semibold text-amber-bar" data-invoice-check-line>{check.error}</span> : null}
        </>
      ) : (
        <p className="text-xs text-muted">The LPO shows amber &quot;Invoice missing&quot;, accounts see it on their list, and Parts get one reminder a day until the number and date are entered.</p>
      )}
    </div>
  );
}

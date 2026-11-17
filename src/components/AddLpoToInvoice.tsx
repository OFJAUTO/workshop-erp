"use client";

import { useState } from "react";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { Input, controlClass } from "@/components/ui";
import type { CoverChoice } from "@/components/SupplierInvoiceBox";

const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "Add another LPO to this invoice" (17 November 2026, Section 2): ONE control, on the opened row of Supplier invoices
 * (and Parts accounts) and on the LPO page. The supplier sent one paper for several LPOs and it was entered on one of
 * them: pick the other LPO and type the paper's total before VAT; the total is shared again by the LPOs' own totals.
 * The answer shows right here (the page comes back opened at this control).
 */
export function AddLpoToInvoice({ invoiceNumber, coversNow, currentTotal, options, action, message, error }: {
  invoiceNumber: string;
  /** The LPOs this invoice covers now. */
  coversNow: string[];
  /** The invoice's before-VAT total as entered now (the shares added up). */
  currentTotal: number;
  options: CoverChoice[];
  action: (formData: FormData) => void;
  message?: string | null;
  error?: string | null;
}) {
  const [open, setOpen] = useState(!!error);
  const [pick, setPick] = useState("");
  const chosen = options.find((o) => o.id === pick) ?? null;
  return (
    <div id="add-lpo" className="flex flex-col gap-2 scroll-mt-24" data-add-lpo>
      {message ? <p className="rounded-control bg-green-soft px-3 py-2 text-sm font-semibold text-green-text" data-add-lpo-message>{message}</p> : null}
      {!options.length ? (
        <p className="text-xs text-muted" data-add-lpo-none>Invoice {invoiceNumber} covers {coversNow.join(" + ")}. The supplier has no other open LPO to add to it.</p>
      ) : !open ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 w-fit items-center rounded-control border-2 border-ink bg-white px-4 text-sm font-bold" data-add-lpo-open>
          Add another LPO to this invoice
        </button>
      ) : (
        <form action={action} className="flex flex-col gap-3 rounded-control border-2 border-ink bg-white p-3" data-add-lpo-form>
          <span className="text-sm font-extrabold uppercase tracking-[0.06em]">Add another LPO to invoice {invoiceNumber}</span>
          <p className="text-xs text-muted">It covers {coversNow.join(" + ")} now (AED {fmt(currentTotal)} before VAT). Pick the other LPO on the same paper, then type the paper&apos;s total before VAT: it is shared by each LPO&apos;s own total, and the invoice goes back to unchecked.</p>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            The other LPO on this paper
            <select name="other_po" required value={pick} onChange={(e) => setPick(e.target.value)} className={controlClass} data-add-lpo-pick>
              <option value="" disabled>Choose the LPO</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.number} · {o.car} · AED {fmt(o.total)} before VAT · {o.status}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
            The paper&apos;s total before VAT (all the LPOs together)
            <Input name="invoice_total" required inputMode="decimal" spell={false} placeholder={chosen ? fmt(currentTotal + chosen.total) : "0.00"} data-add-lpo-total />
          </label>
          {chosen ? <p className="text-xs font-semibold" data-add-lpo-together>The LPOs together: AED {fmt(currentTotal + chosen.total)} before VAT ({[...coversNow, chosen.number].join(" + ")}).</p> : null}
          <div className="flex flex-wrap gap-2">
            <ConfirmSubmit
              label="Add it to the invoice"
              title={`Add ${chosen?.number ?? "the LPO"} to invoice ${invoiceNumber}?`}
              cancelLabel="GO BACK AND EDIT"
              lines={["its \"Invoice missing\" clears", "the total is shared again; accounts check the invoice again"]}
              live={[{ label: "total AED", field: "invoice_total" }]}
              confirmLabel="Yes, add it"
              size="md"
              hook="add-lpo"
            />
            <button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-control border border-line-strong px-4 text-sm font-bold">Cancel</button>
          </div>
        </form>
      )}
      {error ? <p className="text-sm font-bold text-red" data-add-lpo-error>{error}</p> : null}
    </div>
  );
}

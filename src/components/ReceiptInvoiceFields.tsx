"use client";

import { useState, useTransition } from "react";
import { checkReceiptNumberAction } from "@/app/(app)/parts/receipt-actions";
import type { RefType } from "@/lib/receipt-refs";
import { controlClass } from "./ui";

/**
 * THE receipt box (13 November 2026, URGENT; 15 November 2026: receiving never blocks the mechanic): inside every
 * receive form (the LPO page, the car's Parts page). The parts desk records the delivery with ONE reference from the
 * supplier's paper - the type (Invoice number / Pre-payment parts invoice number / WIP number / any added in Settings)
 * and its number - or presses "Arrived - paperwork pending" (any supplier) with the delivery paper's photo or "No paper
 * came". Either way the parts are recorded and can be handed to the technician at once. A number already used for this
 * supplier asks "Same invoice as LPO-…?". Field names are read by receiptInputFrom (src/lib/receipts.ts).
 */
export type ReceiptSupplier = { supplierId: string | null; name: string; laterAllowed: boolean; laterDays: number };

/** A big phone photo is redrawn to 2000 px JPEG on the device so the save stays small. */
async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size < 1_200_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob((b) => r(b), "image/jpeg", 0.82));
    return blob ? new File([blob], file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

export function ReceiptInvoiceFields({ supplier, poIds, dueOn, types = null }: {
  supplier: ReceiptSupplier | null;
  poIds: string[];
  /** When the paperwork of a delivery recorded now would be due ("today" or "18 Nov 2026"), worked out on the server. */
  dueOn: string | null;
  /** The reference types (null until the database change: the invoice number only). */
  types?: RefType[] | null;
}) {
  const [later, setLater] = useState(false);
  const [type, setType] = useState("invoice");
  const [number, setNumber] = useState("");
  const [same, setSame] = useState<string[]>([]);
  const [noPaper, setNoPaper] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [, start] = useTransition();
  if (!supplier) return null;
  const list = types?.length ? types : [{ key: "invoice", label: "Supplier invoice number", counts: true }];
  const current = list.find((t) => t.key === type) ?? list[0];
  const check = (n: string) => start(async () => setSame(n.trim() && current.counts ? await checkReceiptNumberAction(supplier.supplierId, supplier.name, n, poIds) : []));
  const onFile = async (input: HTMLInputElement) => {
    const f = input.files?.[0];
    if (!f) return setPreview(null);
    const small = await shrink(f);
    if (small !== f) {
      const dt = new DataTransfer();
      dt.items.add(small);
      input.files = dt.files;
    }
    setPreview(small.type.startsWith("image/") ? URL.createObjectURL(small) : null);
    setNoPaper(false);
  };
  const dueWords = dueOn === "today" ? "by the end of today" : dueOn ? `by ${dueOn}` : "soon";
  return (
    <div className="flex flex-col gap-3 rounded-card border-2 border-ink bg-white p-3" data-receipt-fields>
      <input type="hidden" name="receipt_invoice_later" value={later ? "1" : "0"} />
      <input type="hidden" name="receipt_ref_label" value={later ? "" : current.label} />
      {!later ? (
        <>
          {list.length > 1 ? (
            <fieldset className="flex flex-col gap-1" data-receipt-ref-types>
              <legend className="text-sm font-bold">Reference on the supplier&apos;s paper <span className="text-red">*</span> <span className="font-normal text-muted">(any one is enough)</span></legend>
              <div className="flex flex-wrap gap-2">
                {list.map((t) => (
                  <label key={t.key} className={`inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-control border px-3 text-sm font-semibold ${type === t.key ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`} data-receipt-ref-type={t.key}>
                    <input type="radio" name="receipt_ref_type" value={t.key} checked={type === t.key} onChange={() => { setType(t.key); setSame([]); }} className="sr-only" />
                    {t.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : <input type="hidden" name="receipt_ref_type" value="invoice" />}
          <label className="flex flex-col gap-1">
            <span className="text-sm font-bold">{current.label} <span className="text-red">*</span></span>
            <input name="receipt_invoice_number" value={number} onChange={(e) => { setNumber(e.target.value); setSame([]); }} onBlur={(e) => check(e.target.value)} required autoComplete="off" className={controlClass} style={{ maxWidth: "20rem" }} placeholder="As printed on the supplier's paper" data-receipt-number />
            {current.counts ? (
              <span className="text-xs text-muted">From {supplier.name}&apos;s paper that came with the parts. Accounts still scan and check the figures.</span>
            ) : (
              <span className="rounded-control bg-amber-soft px-2 py-1 text-xs font-semibold" data-receipt-not-invoice>A {current.label.toLowerCase()} does not count as the supplier&apos;s invoice: the parts are recorded, and the real invoice is still due {dueWords}.</span>
            )}
          </label>
        </>
      ) : (
        <div className="flex flex-col gap-2" data-receipt-later>
          <p className="text-sm font-bold" data-receipt-due-tag>ARRIVED - PAPERWORK PENDING: the parts are recorded now and can be issued to the technician. The supplier&apos;s reference is due {dueWords}.</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">Photo of the delivery paper that came with the part</span>
            <input type="file" name="receipt_paper" accept="image/*,application/pdf" capture="environment" disabled={noPaper} onChange={(e) => void onFile(e.currentTarget)} className="text-sm" data-receipt-paper />
          </label>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of the photo just taken */}
          {preview ? <img src={preview} alt="Delivery paper" className="max-h-40 w-auto self-start rounded-control border border-line" /> : null}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" name="receipt_no_paper" checked={noPaper} onChange={(e) => setNoPaper(e.target.checked)} className="h-5 w-5" data-receipt-no-paper />
            No paper came with the part (this is logged)
          </label>
        </div>
      )}
      {!later && same.length ? (
        <label className="flex min-h-11 items-center gap-2 rounded-control bg-amber-soft px-3 text-sm font-semibold" data-receipt-same>
          <input type="checkbox" name="receipt_same_ok" required className="h-5 w-5" />
          Same invoice as {same.join(", ")}? Tick if one invoice covers both.
        </label>
      ) : null}
      <button type="button" onClick={() => setLater((v) => !v)} className={`min-h-11 self-start rounded-control border px-4 text-sm font-bold ${later ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`} data-receipt-later-button>
        {later ? "The paper came: type the reference" : "Arrived - paperwork pending"}
      </button>
    </div>
  );
}

/** What the check-before-save window shows for the receipt (the ONE wording, both receive forms). */
export function receiptCheckWords(fd: FormData): { number: string; later: boolean; label: string } {
  return { number: String(fd.get("receipt_invoice_number") ?? "").trim(), later: fd.get("receipt_invoice_later") === "1", label: String(fd.get("receipt_ref_label") ?? "").trim() || "Supplier invoice number" };
}

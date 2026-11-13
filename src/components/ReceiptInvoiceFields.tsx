"use client";

import { useState, useTransition } from "react";
import { checkReceiptNumberAction } from "@/app/(app)/parts/receipt-actions";
import { controlClass } from "./ui";

/**
 * THE receipt box (13 November 2026, URGENT): inside every receive form (the LPO page, the car's Parts page). The
 * supplier's invoice number is compulsory; "Invoice comes later" shows only for a supplier marked "Invoice later allowed"
 * and then asks for the delivery paper's photo or "No paper came". A number already used for this supplier asks
 * "Same invoice as LPO-…?" instead of refusing. Field names are read by receiptInputFrom (src/lib/receipts.ts).
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

export function ReceiptInvoiceFields({ supplier, poIds, dueOn }: { supplier: ReceiptSupplier | null; poIds: string[]; /** The day an "invoice later" would be due, worked out on the server. */ dueOn: string | null }) {
  const [later, setLater] = useState(false);
  const [number, setNumber] = useState("");
  const [same, setSame] = useState<string[]>([]);
  const [noPaper, setNoPaper] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [, start] = useTransition();
  if (!supplier) return null;
  const check = (n: string) => start(async () => setSame(n.trim() ? await checkReceiptNumberAction(supplier.supplierId, supplier.name, n, poIds) : []));
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
  return (
    <div className="flex flex-col gap-3 rounded-card border-2 border-ink bg-white p-3" data-receipt-fields>
      <input type="hidden" name="receipt_invoice_later" value={later ? "1" : "0"} />
      {!later ? (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-bold">Supplier invoice number <span className="text-red">*</span></span>
          <input name="receipt_invoice_number" value={number} onChange={(e) => { setNumber(e.target.value); setSame([]); }} onBlur={(e) => check(e.target.value)} required autoComplete="off" className={controlClass} style={{ maxWidth: "20rem" }} placeholder="As printed on the supplier's paper" data-receipt-number />
          <span className="text-xs text-muted">From {supplier.name}&apos;s invoice that came with the parts. Accounts still scan and check the figures.</span>
        </label>
      ) : (
        <div className="flex flex-col gap-2" data-receipt-later>
          <p className="text-sm font-bold" data-receipt-due-tag>Invoice comes later: due within {supplier.laterDays} day{supplier.laterDays === 1 ? "" : "s"}{dueOn ? ` (by ${dueOn})` : ""}.</p>
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
      {supplier.laterAllowed ? (
        <button type="button" onClick={() => setLater((v) => !v)} className={`min-h-11 self-start rounded-control border px-4 text-sm font-bold ${later ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`} data-receipt-later-button>
          {later ? "The invoice came: type the number" : "Invoice comes later"}
        </button>
      ) : null}
    </div>
  );
}

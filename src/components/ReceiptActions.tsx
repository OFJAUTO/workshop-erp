"use client";

import { useState } from "react";
import { ActionForm, type FormAction } from "./forms";
import { Button, Textarea, controlClass } from "./ui";

/**
 * The buttons on one receipt (13 November 2026): type or correct the invoice number, "Retake photo" / "Scan again" for
 * the delivery paper and the invoice, "Photo unclear - ask Parts to retake". Who sees what is decided on the server
 * (src/lib/receipt-rules.ts) and checked again when saving.
 */
export type ReceiptRefRow = { type: string; label: string; number: string };
export function ReceiptActions({ number, canNumber, correcting, fileKinds, canAskRetake, numberAction, fileAction, retakeAction, refs = null, types = null, refAction = null }: {
  number: string | null;
  canNumber: boolean;
  correcting: boolean;
  /** 15 November 2026: the references on the receipt and the types (null until the database change: the invoice number only). */
  refs?: ReceiptRefRow[] | null;
  types?: { key: string; label: string; counts: boolean }[] | null;
  refAction?: FormAction | null;
  fileKinds: ("paper" | "invoice")[];
  canAskRetake: boolean;
  numberAction: FormAction;
  fileAction: Record<string, FormAction>;
  retakeAction: FormAction;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (k: string) => setOpen((o) => (o === k ? null : k));
  const btn = (k: string, label: string, hook: string) => (
    <button type="button" onClick={() => toggle(k)} className={`min-h-11 rounded-control border px-3 text-sm font-bold ${open === k ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`} data-receipt-action={hook}>{label}</button>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {canNumber && types && refAction ? (
          <>
            {correcting ? (refs ?? []).map((x, i) => <span key={i} className="contents">{btn(`change:${i}`, `Change ${x.label.toLowerCase()} ${x.number}`, "change-ref")}</span>) : null}
            {btn("add", (refs ?? []).length ? "Add another reference" : "Type the reference", "add-ref")}
          </>
        ) : canNumber ? btn("number", correcting ? "Correct the invoice number" : "Type the invoice number", correcting ? "correct" : "number") : null}
        {fileKinds.map((k) => (
          <span key={k} className="contents">
            {btn(`photo:${k}`, `Retake photo${fileKinds.length > 1 ? ` (${k === "paper" ? "delivery paper" : "invoice"})` : ""}`, `retake-${k}`)}
            {btn(`scan:${k}`, `Scan again${fileKinds.length > 1 ? ` (${k === "paper" ? "delivery paper" : "invoice"})` : ""}`, `scan-${k}`)}
          </span>
        ))}
        {canAskRetake ? btn("ask", "Photo unclear - ask Parts to retake", "ask-retake") : null}
      </div>
      {types && refAction && (open === "add" || open?.startsWith("change:")) ? (
        <RefForm key={open} action={refAction} types={types} replace={open.startsWith("change:") ? Number(open.slice(7)) : null} current={open.startsWith("change:") ? (refs ?? [])[Number(open.slice(7))] ?? null : null} />
      ) : null}
      {open === "number" ? (
        <ActionForm action={numberAction} className="flex flex-col gap-2 rounded-control bg-surface p-3">
          {(v) => (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">{correcting ? `Correct number (now ${number})` : "Supplier invoice number"}</span>
                <input name="number" defaultValue={v.number ?? ""} required className={controlClass} style={{ maxWidth: "20rem" }} data-receipt-number-input />
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="same_ok" className="h-5 w-5" /> Same invoice as another LPO of this supplier (tick only if asked)</label>
              <div><Button type="submit" size="md" data-receipt-number-save>Save the number</Button></div>
            </>
          )}
        </ActionForm>
      ) : null}
      {fileKinds.map((k) => (open === `photo:${k}` || open === `scan:${k}` ? (
        <ActionForm key={k} action={fileAction[k]} className="flex flex-col gap-2 rounded-control bg-surface p-3">
          {() => (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">{open.startsWith("photo") ? "Take the photo again" : "Scan or choose the file again"} · {k === "paper" ? "delivery paper" : "invoice"}</span>
                {open.startsWith("photo") ? <input type="file" name="file" accept="image/*" capture="environment" required className="text-sm" data-receipt-file-input /> : <input type="file" name="file" accept="image/*,application/pdf" required className="text-sm" data-receipt-file-input />}
              </label>
              <p className="text-xs text-muted">The old file is kept in the history with who replaced it and when.</p>
              <div><Button type="submit" size="md" data-receipt-file-save>Save</Button></div>
            </>
          )}
        </ActionForm>
      ) : null))}
      {open === "ask" ? (
        <ActionForm action={retakeAction} className="flex flex-col gap-2 rounded-control bg-surface p-3">
          {() => (
            <>
              <Textarea name="note" rows={2} placeholder="What is unclear (for example: the total is cut off)" data-receipt-ask-note />
              <div><Button type="submit" size="md" data-receipt-ask-send>Send back to the parts desk</Button></div>
            </>
          )}
        </ActionForm>
      ) : null}
    </div>
  );
}

/** One reference: its type (one tap) and its number. Changing one keeps the old in the receipt's history. */
function RefForm({ action, types, replace, current }: { action: FormAction; types: { key: string; label: string; counts: boolean }[]; replace: number | null; current: ReceiptRefRow | null }) {
  const [type, setType] = useState(current?.type ?? "invoice");
  const t = types.find((x) => x.key === type) ?? types[0];
  return (
    <div data-receipt-ref-form>
    <ActionForm action={action} className="flex flex-col gap-2 rounded-control bg-surface p-3">
      {(v) => (
        <>
          <input type="hidden" name="replace" value={replace === null ? "" : String(replace)} />
          <div className="flex flex-wrap gap-2">
            {types.map((x) => (
              <label key={x.key} className={`inline-flex min-h-11 cursor-pointer items-center rounded-control border px-3 text-sm font-semibold ${type === x.key ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`} data-receipt-ref-type={x.key}>
                <input type="radio" name="type" value={x.key} checked={type === x.key} onChange={() => setType(x.key)} className="sr-only" />
                {x.label}
              </label>
            ))}
          </div>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-semibold">{current ? `${t.label} (now ${current.label.toLowerCase()} ${current.number})` : t.label}</span>
            <input name="number" defaultValue={v.number ?? current?.number ?? ""} required className={controlClass} style={{ maxWidth: "20rem" }} data-receipt-number-input />
            {!t.counts ? <span className="text-xs font-semibold">Does not count as the supplier&apos;s invoice: the real invoice stays due.</span> : null}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="same_ok" className="h-5 w-5" /> Same invoice as another LPO of this supplier (tick only if asked)</label>
          <div><Button type="submit" size="md" data-receipt-number-save>Save</Button></div>
        </>
      )}
    </ActionForm>
    </div>
  );
}

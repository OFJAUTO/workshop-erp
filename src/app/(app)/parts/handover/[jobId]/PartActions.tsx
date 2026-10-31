"use client";

import { ReasonChips } from "@/components/ReasonChips";

import { useState } from "react";
import { QueuedProofView, useQueuedProof } from "@/components/QueuedProofUpload";
import { Badge, Button, Input, Textarea } from "@/components/ui";
import { DISPOSITIONS, EXCHANGE_REASONS, type PartState } from "@/lib/part-state";

type Action = (formData: FormData) => void | Promise<void>;

/** The one state of a part, as a small tag. */
export function PartStateBadge({ state }: { state: PartState }) {
  return <Badge tone={state.tone}>{state.label}</Badge>;
}

/**
 * Under a part on the handover page: "Wrong or faulty" (one-tap reason, then the exchange starts) and
 * "Not needed" (a reason). Only the input the chosen action needs opens, and closes when done.
 */
export function PartActions({ partId, back, canExchange, canNotNeeded, exchangeAction, notNeededAction, notNeededReasons = [] }: { partId: string; back?: string; canExchange: boolean; canNotNeeded: boolean; exchangeAction: Action; notNeededAction: Action; /** One-tap reasons for "not needed" (Settings). */ notNeededReasons?: string[] }) {
  const [open, setOpen] = useState<null | "exchange" | "not_needed">(null);
  const [reason, setReason] = useState("");
  if (!canExchange && !canNotNeeded) return null;
  if (open === "exchange") {
    return (
      <form action={exchangeAction} className="flex flex-col gap-2 rounded-control border border-line bg-white p-3">
        <input type="hidden" name="part" value={partId} />
        {back ? <input type="hidden" name="back" value={back} /> : null}
        <span className="text-sm font-semibold">What is wrong with it?</span>
        <div className="flex flex-wrap gap-1.5">
          {EXCHANGE_REASONS.map((r) => (
            <button key={r.value} type="button" onClick={() => setReason(r.value)} aria-pressed={reason === r.value} className={`min-h-10 rounded-control border px-3 text-sm font-bold ${reason === r.value ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>{reason === r.value ? "✓ " : ""}{r.label}</button>
          ))}
        </div>
        <input type="hidden" name="reason" value={reason} />
        <Textarea name="note" rows={1} placeholder="Note (optional): part number on the box, what was wrong" textCase="sentence" className="min-h-12" />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="md" disabled={!reason}>Back to the supplier, order the correct part</Button>
          <Button type="button" tone="ghost" size="md" onClick={() => { setOpen(null); setReason(""); }}>Cancel</Button>
        </div>
      </form>
    );
  }
  if (open === "not_needed") {
    return (
      <form action={notNeededAction} className="flex flex-col gap-2 rounded-control border border-line bg-white p-3">
        <input type="hidden" name="part" value={partId} />
        {back ? <input type="hidden" name="back" value={back} /> : null}
        <ReasonChips name="reason" label="Why is it not needed?" options={notNeededReasons} required placeholder="For example: the old one was fine after cleaning" textCase="sentence" />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="md">Mark not needed</Button>
          <Button type="button" tone="ghost" size="md" onClick={() => setOpen(null)}>Cancel</Button>
        </div>
      </form>
    );
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {canExchange ? <button type="button" onClick={() => setOpen("exchange")} className="min-h-9 rounded-control border border-line-strong bg-white px-2.5 text-xs font-bold">Wrong or faulty part</button> : null}
      {canNotNeeded ? <button type="button" onClick={() => setOpen("not_needed")} className="min-h-9 rounded-control border border-line-strong bg-white px-2.5 text-xs font-bold">Not needed</button> : null}
    </span>
  );
}

/** Where a part without a home goes: returned to the supplier with a credit note, to stock, or fitted with the owner's approval. */
export function EndingForm({ partId, back, action }: { partId: string; back?: string; action: Action }) {
  const [choice, setChoice] = useState("");
  return (
    <form action={action} className="flex flex-col gap-2 rounded-control border border-line bg-white p-3">
      <input type="hidden" name="part" value={partId} />
      {back ? <input type="hidden" name="back" value={back} /> : null}
      <span className="text-sm font-semibold">Where does it go?</span>
      <div className="flex flex-wrap gap-1.5">
        {DISPOSITIONS.map((d) => (
          <button key={d.value} type="button" onClick={() => setChoice(d.value)} aria-pressed={choice === d.value} className={`min-h-10 rounded-control border px-3 text-sm font-bold ${choice === d.value ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`}>{choice === d.value ? "✓ " : ""}{d.label}</button>
        ))}
      </div>
      <input type="hidden" name="disposition" value={choice} />
      {choice === "returned" ? (
        <ReturnedFields key={partId} partId={partId} />
      ) : (
        <>
          {choice ? <Textarea name="note" rows={1} placeholder={choice === "stock" ? "Shelf or bin (optional)" : choice === "scrap" ? "Why it is scrapped (required)" : "Why fit it anyway (the owner reads this)"} textCase="sentence" className="min-h-12" required={choice === "scrap"} /> : null}
          {choice === "fit_pending" ? <span className="text-xs text-muted">The owner approves it as goodwill; the part then goes to the technician as usual.</span> : null}
          <div><Button type="submit" size="md" disabled={!choice}>Save the ending</Button></div>
        </>
      )}
    </form>
  );
}

/**
 * Returned to the supplier: the credit note number and/or its scan (31 October 2026: the scan is kept on this device until
 * OFJ's server has it and goes straight to storage). With a number typed the ending can be saved at once and a scan still
 * on its way lands on the part by itself; without a number it waits for the scan, because the ending needs one of them.
 */
function ReturnedFields({ partId }: { partId: string }) {
  const [number, setNumber] = useState("");
  const scan = useQueuedProof({ target: "credit_note", scopeId: partId });
  const waitForScan = !number.trim() && !scan.ready && (scan.waiting || scan.stopped);
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Credit note number<Input name="note" placeholder="From the supplier" textCase="upper" onChange={(e) => setNumber(e.target.value)} /></label>
        <div className="flex flex-col gap-1 text-xs font-semibold text-muted" data-credit-note-scan>
          <span>Scan of the credit note (optional)</span>
          <QueuedProofView
            proof={scan}
            label={scan.ready || scan.waiting ? "Use another scan" : "Add the scan"}
            buttonClass="min-h-11 w-fit rounded-control border border-line-strong bg-white px-4 text-sm font-bold text-ink disabled:opacity-50"
            buttonData={{ "data-credit-note-upload": "" }}
            inputData={{ "data-credit-note-file": "" }}
            pathName="credit_note_path"
            pendingName="credit_note_pending"
            readyWords="Scan ready"
            waitingHint={number.trim() ? "You can save now: the scan joins the part by itself when it arrives." : undefined}
          />
        </div>
      </div>
      {waitForScan ? <span className="text-xs font-semibold text-amber" data-credit-note-wait>{scan.stopped ? "The scan could not be sent: type the credit note number, or remove the scan and add it again." : "Type the credit note number, or wait for the scan to finish sending."}</span> : null}
      <div><Button type="submit" size="md" disabled={waitForScan}>Save the ending</Button></div>
    </>
  );
}

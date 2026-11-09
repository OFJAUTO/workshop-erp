"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Input } from "@/components/ui";
import { JobFileUpload } from "@/components/JobFileUpload";
import { MoneyDate } from "@/components/MoneyDate";
import { reloadIfStale } from "@/lib/app-version";
import type { PurchaseReturn } from "@/lib/purchase-returns";
import { RETURN_STATUS_WORDS } from "@/lib/purchase-returns-words";
import { markReturnRefused, markReturnReplaced, markReturnSent, recordReturnCredit, recordReturnRefund, setReturnQuantity, decideReturnWriteOff, type ReturnAnswer } from "./actions";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * ONE purchase return on the list (8 November 2026): its status, the return note for the supplier, and the next step
 * for whoever is looking - Parts send it back and close a replacement or a refusal; accounts record the credit or the
 * refund; the owner decides a write-off. The answer shows on the row itself.
 */
export function ReturnRow({ r, today, canParts, canMoney, isOwner }: { r: PurchaseReturn; today: string; canParts: boolean; canMoney: boolean; isOwner: boolean }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [answer, setAnswer] = useState<ReturnAnswer | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const run = (fn: (fd: FormData) => Promise<ReturnAnswer>) => (fd: FormData) =>
    start(async () => {
      try {
        const a = await fn(fd);
        setAnswer(a);
        if (!a.error) { setOpen(null); router.refresh(); }
      } catch (e) {
        if (reloadIfStale(e)) return;
        setAnswer({ error: "No connection – nothing was saved. Try again." });
      }
    });
  const openStatus = r.status === "requested" || r.status === "sent";
  const tab = (key: string, label: string) => (
    <Button type="button" size="md" tone={open === key ? "primary" : "secondary"} onClick={() => setOpen(open === key ? null : key)} data-return-open={key}>{label}</Button>
  );
  return (
    <li id={r.number} className="flex flex-col gap-2 py-3" data-return-row={r.number} data-return-status={r.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-extrabold">{r.number}</span>
        <Badge tone={r.status === "sent" ? "amber" : r.status === "refused" ? "red" : openStatus ? "ink" : "green"}>{RETURN_STATUS_WORDS[r.status]}</Badge>
        {r.status === "sent" ? <span className={`text-xs font-bold ${r.daysWaiting >= 7 ? "text-red" : "text-muted"}`} data-return-days>{r.daysWaiting} day{r.daysWaiting === 1 ? "" : "s"} waiting</span> : null}
        {openStatus ? <span className="text-sm font-bold" data-return-expected>Credit expected {aed(r.expected)}</span> : null}
        <a href={`/api/pdf/return-note/${r.id}`} target="_blank" rel="noreferrer" className="ml-auto inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4" data-return-note>Return note (PDF)</a>
      </div>
      <div className="text-sm">
        <span className="font-semibold uppercase">{r.description}</span> × {r.quantity}
        {r.partNumber ? <span className="text-muted"> · {r.partNumber}</span> : null}
        <span className="text-muted"> · {r.supplier}{r.poNumber ? ` · ${r.poNumber}` : ""}{r.invoiceNumber ? ` · their invoice ${r.invoiceNumber}` : ""}{r.jobNumber ? ` · ${r.jobNumber}` : ""}</span>
      </div>
      <p className="text-xs text-muted">Reason: {r.reason}{r.sentAt ? ` · sent back ${r.sentAt.slice(0, 10)} with ${r.sentWith ?? ""}` : ""}{r.creditNumber ? ` · credit note ${r.creditNumber} ${aed((r.creditNet ?? 0) + (r.creditVat ?? 0))}` : ""}{r.refund !== null ? ` · refund ${aed(r.refund)} (${r.refundMethod})` : ""}{r.restockFee ? ` · restocking fee ${aed(r.restockFee)} to ${r.costTo === "job" ? "the job" : "overhead"}` : ""}{r.outcomeNote ? ` · ${r.outcomeNote}` : ""}</p>
      {r.lpoPaid && (r.status === "credited") ? <p className="text-xs font-semibold text-green-text" data-return-advance>The LPO was already paid: this credit is money {r.supplier} owes us – take it off the next payment.</p> : null}
      {r.status === "refused" && r.writeOffStatus === "pending" ? <p className="text-xs font-semibold text-amber-text" data-return-writeoff-pending>Write-off waiting for the owner.</p> : null}

      <div className="flex flex-wrap gap-2">
        {r.status === "requested" && canParts ? tab("sent", "Sent back") : null}
        {r.status === "requested" && canParts ? tab("qty", "Fewer pieces") : null}
        {openStatus && canMoney ? tab("credit", "Credit received") : null}
        {openStatus && canMoney ? tab("refund", "Refund received") : null}
        {openStatus && canParts ? tab("replaced", "Replaced") : null}
        {openStatus && canParts ? tab("refused", "Refused by supplier") : null}
        {r.status === "refused" && r.writeOffStatus === "pending" && isOwner ? tab("writeoff", "Decide the write-off") : null}
      </div>

      {open === "sent" ? (
        <form action={run((fd) => markReturnSent(r.id, fd))} className="flex flex-col gap-2 rounded-card border border-line p-3" data-return-form="sent">
          <div className="flex flex-wrap items-end gap-3">
            <MoneyDate name="sent_on" label="Sent back on" defaultValue={today} max={today} hook="data-return-sent-on" />
            <label className="flex min-w-56 flex-1 flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Who took it (or who collected it)</span><Input name="sent_with" required minLength={2} placeholder="e.g. Ravi (our driver) / Gargash driver Ali" data-return-sent-with /></label>
          </div>
          {r.jobId ? <JobFileUpload jobId={r.jobId} kind="return_photo" refId={r.id} files={[]} label="Photo of the signed slip" caption={`Signed return slip ${r.number}`} /> : null}
          <Button type="submit" size="md" disabled={busy} data-return-sent-save>{busy ? "Saving…" : "Save: sent back"}</Button>
        </form>
      ) : null}
      {open === "qty" ? (
        <form action={run((fd) => setReturnQuantity(r.id, fd))} className="flex flex-wrap items-end gap-2 rounded-card border border-line p-3" data-return-form="qty">
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">How many go back</span><Input name="quantity" inputMode="decimal" defaultValue={String(r.quantity)} className="w-28" data-return-qty /></label>
          <Button type="submit" size="md" disabled={busy}>Save</Button>
        </form>
      ) : null}
      {open === "credit" ? (
        <form action={run((fd) => recordReturnCredit(r.id, fd))} className="flex flex-col gap-2 rounded-card border border-line p-3" data-return-form="credit">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-40 flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Credit note number</span><Input name="credit_number" required data-return-cn-number /></label>
            <MoneyDate name="credit_date" label="Credit note date" defaultValue="" max={today} hook="data-return-cn-date" />
            <label className="flex w-36 flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Before VAT</span><Input name="credit_net" inputMode="decimal" required data-return-cn-net /></label>
            <label className="flex w-32 flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">VAT as printed</span><Input name="credit_vat" inputMode="decimal" defaultValue="0" data-return-cn-vat /></label>
            <label className="flex w-36 flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Restocking fee</span><Input name="restock_fee" inputMode="decimal" defaultValue="0" data-return-fee /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Fee goes to</span><select name="cost_to" className="min-h-11 rounded-control border border-line px-2" defaultValue="overhead"><option value="overhead">Overhead</option><option value="job">The job</option></select></label>
          </div>
          {r.jobId ? <JobFileUpload jobId={r.jobId} kind="supplier_invoice" refId={r.id} files={[]} label="Scan of the credit note" caption={`Credit note for ${r.number}`} /> : null}
          <Button type="submit" size="md" disabled={busy} data-return-cn-save>{busy ? "Saving…" : "Save the credit"}</Button>
        </form>
      ) : null}
      {open === "refund" ? (
        <form action={run((fd) => recordReturnRefund(r.id, fd))} className="flex flex-wrap items-end gap-3 rounded-card border border-line p-3" data-return-form="refund">
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">How</span><select name="refund_method" className="min-h-11 rounded-control border border-line px-2" defaultValue="transfer"><option value="transfer">Transfer</option><option value="cheque">Cheque</option><option value="cash">Cash</option><option value="card">Card</option></select></label>
          <MoneyDate name="refund_date" label="Refund date" defaultValue="" max={today} />
          <label className="flex w-36 flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Amount</span><Input name="refund_amount" inputMode="decimal" required /></label>
          <label className="flex w-36 flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Restocking fee</span><Input name="restock_fee" inputMode="decimal" defaultValue="0" /></label>
          <Button type="submit" size="md" disabled={busy}>Save the refund</Button>
        </form>
      ) : null}
      {open === "replaced" ? (
        <form action={run((fd) => markReturnReplaced(r.id, fd))} className="flex flex-wrap items-end gap-2 rounded-card border border-line p-3" data-return-form="replaced">
          <label className="flex min-w-64 flex-1 flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Note (the replacement part, its delivery note)</span><Input name="note" /></label>
          <Button type="submit" size="md" disabled={busy}>Save: replaced</Button>
        </form>
      ) : null}
      {open === "refused" ? (
        <form action={run((fd) => markReturnRefused(r.id, fd))} className="flex flex-wrap items-end gap-3 rounded-card border border-line p-3" data-return-form="refused">
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">The part</span><select name="refused_action" className="min-h-11 rounded-control border border-line px-2" defaultValue="stock" data-return-refused-action><option value="stock">Back to our stock at cost</option><option value="write_off">Write it off (owner approves)</option></select></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Cost goes to</span><select name="cost_to" className="min-h-11 rounded-control border border-line px-2" defaultValue="overhead"><option value="overhead">Overhead</option><option value="job">The job</option></select></label>
          <label className="flex min-w-64 flex-1 flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Why the supplier refused</span><Input name="note" required minLength={3} data-return-refused-note /></label>
          <Button type="submit" size="md" tone="danger" disabled={busy} data-return-refused-save>Save: refused</Button>
        </form>
      ) : null}
      {open === "writeoff" ? (
        <form action={run((fd) => decideReturnWriteOff(r.id, fd))} className="flex flex-wrap items-end gap-3 rounded-card border border-line p-3" data-return-form="writeoff">
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Cost goes to</span><select name="cost_to" className="min-h-11 rounded-control border border-line px-2" defaultValue={r.costTo ?? "overhead"}><option value="overhead">Overhead</option><option value="job">The job</option></select></label>
          <Button type="submit" size="md" name="decision" value="approve" disabled={busy}>Approve the write-off</Button>
          <Button type="submit" size="md" tone="secondary" name="decision" value="decline" disabled={busy}>Decline</Button>
        </form>
      ) : null}
      {answer?.error ? <p className="text-sm font-semibold text-red" role="alert" data-return-error>{answer.error}</p> : null}
      {answer?.message ? <p className="text-sm font-semibold text-green-text" data-return-done>{answer.message}</p> : null}
    </li>
  );
}

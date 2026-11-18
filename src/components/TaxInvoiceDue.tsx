"use client";

import { useActionState } from "react";
import { Button, Input } from "@/components/ui";
import type { TaxDueAnswer } from "@/app/(app)/invoices/tax-due-actions";
import { CHEQUE_TAX_WHEN, CHEQUE_TAX_WORDS, type ChequeTaxWhen } from "@/lib/tax-invoice-due-rules";

export type TaxDueView = {
  jobNumber: string;
  proformaNumber: string;
  words: string;
  daysSince: number;
  warn: boolean;
  late: boolean;
  state: "paid" | "covered" | "due";
  waiting: string;
  dueAmount: string;
  asked: { by: string | null; at: string } | null;
};

/**
 * THE tax-invoice-due card (18 November 2026, Section 1): the deadline ("TAX INVOICE DUE BY <date>", 14 days from
 * completion, warned from day 10) with its fix beside it, "Issue tax invoice now" - at once when the job is paid in
 * full, through the owner's approval when a cheque or transfer still clearing covers it. Invoice and money pages.
 */
export function TaxInvoiceDue({ v, mayIssue, isOwner, action }: { v: TaxDueView; mayIssue: boolean; isOwner: boolean; action: (s: TaxDueAnswer, f: FormData) => Promise<TaxDueAnswer> }) {
  const [state, formAction, pending] = useActionState(action, null);
  const red = v.late || v.warn;
  const tone = red ? "border-red-bar bg-red-soft" : "border-amber-bar bg-amber-soft";
  const label = v.state === "covered" && !isOwner ? "Issue tax invoice now (owner approves)" : "Issue tax invoice now";
  return (
    <div id="tax-due" className={`flex flex-col gap-2 rounded-card border-2 p-3 ${tone}`} data-tax-due={v.state} data-tax-due-warn={v.warn ? "1" : "0"}>
      <span className={`text-sm font-extrabold ${red ? "text-red" : "text-amber-text"}`} data-tax-due-words>{v.words}</span>
      <span className="text-sm">
        {v.jobNumber} was completed {v.daysSince} day{v.daysSince === 1 ? "" : "s"} ago and {v.proformaNumber} is still a proforma.{" "}
        {v.state === "paid" ? "It is paid in full: the tax invoice was not made." : v.state === "covered" ? `${v.waiting} waiting to clear covers it.` : `${v.dueAmount} is still due: record the payment, then the tax invoice follows.`}
      </span>
      {v.asked ? <span className="text-sm font-bold text-amber-text" data-tax-due-asked>Asked{v.asked.by ? ` by ${v.asked.by}` : ""} – waiting for the owner.</span> : null}
      {state?.words ? <span className="rounded-control border border-green bg-green-soft px-2 py-1 text-sm font-bold text-green-text" data-tax-due-answer>{state.words}</span> : null}
      {state?.error ? <span className="text-sm font-bold text-red" data-tax-due-error>{state.error}</span> : null}
      {mayIssue && v.state !== "due" && !v.asked && !state?.words ? (
        <form action={formAction} className="flex flex-wrap items-end gap-2">
          {v.state === "covered" && !isOwner ? <label className="flex min-w-56 flex-1 flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Note for the owner (optional)</span><Input name="note" placeholder="e.g. The customer needs the tax invoice for their accounts" data-tax-due-note /></label> : null}
          <Button type="submit" size="md" disabled={pending} data-tax-due-issue>{pending ? "Working…" : label}</Button>
        </form>
      ) : null}
    </div>
  );
}

/** Settings box: when the tax invoice of a cheque payment is issued (owner and accounts). No choice is pre-selected beyond the saved one. */
export function ChequeTaxWhenBox({ current, action }: { current: ChequeTaxWhen; action: (s: TaxDueAnswer, f: FormData) => Promise<TaxDueAnswer> }) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-2" data-cheque-tax-when>
      <span className="text-sm font-bold">For cheque payments, issue the tax invoice:</span>
      <div className="flex flex-col gap-1">
        {CHEQUE_TAX_WHEN.map((w) => (
          <label key={w} className="flex min-h-11 items-center gap-2 text-sm">
            <input type="radio" name="when" value={w} defaultChecked={w === current} className="h-5 w-5 accent-ink" data-cheque-tax-option={w} />
            {CHEQUE_TAX_WORDS[w]}
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="md" disabled={pending} data-cheque-tax-save>{pending ? "Saving…" : "Save"}</Button>
        {state?.words ? <span className="text-sm font-bold text-green-text" data-cheque-tax-saved>{state.words}</span> : null}
        {state?.error ? <span className="text-sm font-bold text-red">{state.error}</span> : null}
      </div>
    </form>
  );
}

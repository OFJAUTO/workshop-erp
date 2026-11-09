"use client";

import { useActionState, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button, Input } from "@/components/ui";
import { MoneyDate } from "@/components/MoneyDate";
import { SlipTile } from "@/components/PaymentReport";
import { bounceBankAction, clearBankAction, markDepositedAction, type BankAnswer } from "@/app/(app)/accounts-posting/actions";
import type { BankWaiting } from "@/lib/bank-posting";

/*
 * Cheques and bank transfers waiting for the bank (9 November 2026, Section 2): ONE row with its buttons (Mark
 * deposited · Mark cleared / Confirmed in bank · Bounced / Never arrived), used by Accounts posting's Cheque and Bank
 * transfer tabs and by the job's money page; and ONE record row (tick the payments, the day the money reached the bank,
 * the amount, the statement reference, Record) like the card settlements. Every answer shows next to its button.
 */

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (iso: string) => new Date(Date.parse(iso) + 4 * 3600000).toISOString().slice(0, 10);

/* A row that clears or bounces leaves the list at once (its money is no longer waiting): its answer shows in ONE centre
 * window held outside the row (BankAnswerHost, on the page), never lost with the row. */
let shown: { words: string; at: number } | null = null;
const listeners = new Set<() => void>();
function showAnswer(words: string, at: number) {
  if (shown?.at === at) return;
  shown = { words, at };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
export function BankAnswerHost() {
  const a = useSyncExternalStore(subscribe, () => shown, () => null);
  if (!a) return null;
  const close = () => { shown = null; listeners.forEach((l) => l()); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" onClick={close}>
      <div className="flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-card bg-white p-5" onClick={(e) => e.stopPropagation()} data-bank-answer>
        <span className="text-lg font-extrabold">Saved</span>
        <p className="rounded-control border border-green bg-green-soft px-3 py-2 text-sm font-bold text-green-text" data-bank-answer-words>{a.words}</p>
        <div><Button type="button" size="md" onClick={close} data-bank-answer-ok>OK</Button></div>
      </div>
    </div>
  );
}

function Answer({ state }: { state: BankAnswer | null }) {
  if (!state) return null;
  return state.error ? <p className="text-sm font-semibold text-red" data-bank-error>{state.error}</p> : state.message ? <p className="rounded-control border border-green bg-green-soft px-3 py-2 text-sm font-bold text-green-text" data-bank-done>{state.message}</p> : null;
}

/** One cheque or transfer with its buttons (the money page and Accounts posting). */
export function BankRow({ row, today, canSave, ready, proofUrl = null, withTick = false, ticked = false, onTick }: { row: BankWaiting; today: string; canSave: boolean; ready: boolean; proofUrl?: string | null; withTick?: boolean; ticked?: boolean; onTick?: (on: boolean) => void }) {
  const [open, setOpen] = useState<"deposit" | "clear" | "bounce" | null>(null);
  const [dep, depAction, depBusy] = useActionState(markDepositedAction.bind(null, row.id), null);
  const [clr, clrAction, clrBusy] = useActionState(clearBankAction, null);
  const [bnc, bncAction, bncBusy] = useActionState(bounceBankAction.bind(null, row.id), null);
  const cheque = row.method === "cheque";
  const done = !!clr?.message || !!bnc?.message;
  useEffect(() => { for (const st of [dep, clr, bnc]) if (st?.message) showAnswer(st.message, st.at); }, [dep, clr, bnc]);
  const received = day(row.receivedAt);
  return (
    <li className="flex flex-col gap-2 py-3" data-bank-row={row.number} data-bank-method={row.method}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {withTick ? <input type="checkbox" checked={ticked} disabled={!!row.notDue || done} onChange={(e) => onTick?.(e.target.checked)} className="h-5 w-5 accent-ink" aria-label={`Tick ${row.number}`} data-bank-tick={row.number} /> : null}
        <span className="font-bold">{row.number}</span>
        <span className="font-extrabold">{aed(row.amount)}</span>
        <span className="text-muted">{cheque ? `Cheque ${row.chequeNumber ?? ""}${row.chequeBank ? ` · ${row.chequeBank}` : ""}${row.chequeDate ? ` · dated ${row.chequeDate}` : ""}` : `Transfer${row.reference ? ` · ref ${row.reference}` : ""}`}</span>
        <span className="text-muted">received {received}</span>
        {row.jobNumber ? <a href={`/jobs/${row.jobId}/invoice`} className="font-semibold underline underline-offset-4">{row.jobNumber}</a> : null}
        {row.plate ? <span className="uppercase">{row.plate}</span> : null}
        {row.customer ? <span className="text-muted">{row.customer}</span> : null}
        {row.notDue ? <span className="rounded-control border border-amber-bar bg-amber-soft px-2 py-0.5 text-xs font-bold" data-bank-not-due>Post-dated: {row.notDue}</span> : null}
        {row.depositedAt ? <span className="rounded-control border border-line bg-white px-2 py-0.5 text-xs font-bold" data-bank-deposited>Deposited {row.depositedAt}{row.depositedTo ? ` · ${row.depositedTo}` : ""}</span> : cheque ? <span className="text-xs font-semibold text-amber-text" data-bank-received>Received – not deposited yet</span> : <span className="text-xs font-semibold text-amber-text" data-bank-received>Waiting for the bank</span>}
        {row.late ? <span className="text-xs font-semibold text-amber-text">older than 3 working days</span> : null}
        {row.group ? <span className="w-full text-xs font-bold" data-bank-group={row.group.number}>{row.group.words} · {row.group.number}: clears and bounces as one</span> : null}
        {proofUrl ? <SlipTile url={proofUrl} path={row.proofPath} label={`${row.number} proof`} hook={row.number} size="h-9 w-9" /> : null}
      </div>
      {canSave && !done ? (
        <div className="flex flex-wrap gap-2">
          {cheque && ready && !row.depositedAt ? <Button type="button" size="md" tone={open === "deposit" ? "primary" : "secondary"} disabled={!!row.notDue} onClick={() => setOpen(open === "deposit" ? null : "deposit")} data-bank-open="deposit">Mark deposited</Button> : null}
          <Button type="button" size="md" tone={open === "clear" ? "primary" : "secondary"} disabled={!!row.notDue} onClick={() => setOpen(open === "clear" ? null : "clear")} data-bank-open="clear">{cheque ? "Mark cleared" : "Confirmed in bank"}</Button>
          <Button type="button" size="md" tone="ghost" onClick={() => setOpen(open === "bounce" ? null : "bounce")} data-bank-open="bounce">{cheque ? "Bounced" : "Never arrived"}</Button>
        </div>
      ) : null}
      {open === "deposit" && !dep?.message ? (
        <form action={depAction} className="flex flex-wrap items-end gap-2 rounded-control border border-line bg-white p-3" data-bank-form="deposit">
          <MoneyDate name="deposited_on" label="Deposited on" max={today} min={received} minWords="the day it was received" defaultValue="" hook="data-bank-deposit-date" />
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Into which bank account</span><Input name="deposited_to" required defaultValue="Emirates NBD current account" className="w-64" data-bank-deposit-account /></label>
          <Button type="submit" size="md" disabled={depBusy} data-bank-save="deposit">{depBusy ? "Saving…" : "Save"}</Button>
        </form>
      ) : null}
      <Answer state={dep} />
      {open === "clear" && !clr?.message ? (
        <form action={clrAction} className="flex flex-wrap items-end gap-2 rounded-control border border-line bg-white p-3" data-bank-form="clear">
          <input type="hidden" name="ids" value={row.id} />
          <MoneyDate name="settled_on" label={cheque ? "Cleared on (the day on the statement)" : "Reached the bank on"} defaultValue="" max={today} min={row.depositedAt ?? received} minWords={row.depositedAt ? "the day it was deposited" : "the day it was received"} hook="data-bank-clear-date" />
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">{cheque ? "Amount" : "Amount actually received"}</span><Input name="amount" inputMode="decimal" required defaultValue={(row.group?.total ?? row.amount).toFixed(2)} className="w-36" data-bank-clear-amount /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Statement reference</span><Input name="statement_ref" className="w-48" data-bank-clear-ref /></label>
          <Button type="submit" size="md" disabled={clrBusy} data-bank-save="clear">{clrBusy ? "Saving…" : "Record"}</Button>
          {!cheque ? <span className="w-full text-xs text-muted">Less arrived: the balance stays open. More arrived: the rest becomes an advance.</span> : null}
        </form>
      ) : null}
      <Answer state={clr} />
      {open === "bounce" && !bnc?.message ? (
        <form action={bncAction} className="flex flex-wrap items-end gap-2 rounded-control border border-red-bar bg-red-soft p-3" data-bank-form="bounce">
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Bank charge (optional)</span><Input name="bounce_charge" inputMode="decimal" className="w-32" data-bank-bounce-charge /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Note</span><Input name="bounce_note" className="w-64" data-bank-bounce-note /></label>
          <Button type="submit" size="md" tone="danger" disabled={bncBusy} data-bank-save="bounce">{bncBusy ? "Saving…" : cheque ? "Yes, it bounced" : "Yes, it never arrived"}</Button>
          <span className="w-full text-xs text-muted">The payment reverses, the balance is due again, the advisor and the owner are told.</span>
        </form>
      ) : null}
      <Answer state={bnc} />
    </li>
  );
}

/** Accounts posting's Cheque / Bank transfer tab: the rows with ticks and the one record row. */
export function BankPostingPanel({ method, rows, today, canSave, ready, proofUrls }: { method: "cheque" | "transfer"; rows: BankWaiting[]; today: string; canSave: boolean; ready: boolean; proofUrls: Record<string, string> }) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [state, action, busy] = useActionState(clearBankAction, null);
  const [amount, setAmount] = useState<string | null>(null);
  const picked = rows.filter((r) => ticked.has(r.id));
  const sum = Math.round(picked.reduce((a, r) => a + r.amount, 0) * 100) / 100;
  const newest = useMemo(() => picked.map((r) => r.depositedAt ?? day(r.receivedAt)).sort().pop() ?? null, [picked]);
  const word = method === "cheque" ? "cheque" : "transfer";
  useEffect(() => { if (state?.message) showAnswer(state.message, state.at); }, [state]);
  return (
    <div className="flex flex-col gap-3" data-bank-panel={method}>
      {rows.length ? (
        <ul className="divide-y divide-line" data-bank-list>
          {rows.map((r) => <BankRow key={r.id} row={r} today={today} canSave={canSave} ready={ready} proofUrl={r.proofPath ? (proofUrls[r.proofPath] ?? null) : null} withTick={canSave} ticked={ticked.has(r.id)} onTick={(on) => { setTicked((s) => { const n = new Set(s); for (const x of rows.filter((y) => y.id === r.id || (!!r.group && y.group?.number === r.group.number))) { if (on) n.add(x.id); else n.delete(x.id); } return n; }); setAmount(null); }} />)}
        </ul>
      ) : (
        <p className="text-sm text-muted" data-bank-empty>No {word}s waiting for the bank.</p>
      )}
      {canSave && rows.length ? (
        <form action={action} className="flex flex-wrap items-end gap-3 rounded-control border-2 border-line-strong bg-white p-3" data-bank-record>
          {picked.map((r) => <input key={r.id} type="hidden" name="ids" value={r.id} />)}
          <span className="w-full text-sm font-bold">{picked.length ? `${picked.length} ${word}${picked.length === 1 ? "" : "s"} ticked · ${aed(sum)}` : `Tick the ${word}s this bank entry covers`}</span>
          <MoneyDate name="settled_on" label="Money reached the bank on" defaultValue="" max={today} min={newest} minWords="the newest ticked payment" hook="data-bank-record-date" />
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Amount</span><Input name="amount" inputMode="decimal" required value={amount ?? (sum ? sum.toFixed(2) : "")} onChange={(e) => setAmount(e.target.value)} className="w-36" data-bank-record-amount /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Statement reference</span><Input name="statement_ref" className="w-48" data-bank-record-ref /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Bank fee (only if one was taken)</span><Input name="fee" inputMode="decimal" className="w-32" data-bank-record-fee /></label>
          <Button type="submit" size="md" disabled={busy || !picked.length} data-bank-record-save>{busy ? "Saving…" : "Record"}</Button>
        </form>
      ) : null}
      <Answer state={state} />
    </div>
  );
}

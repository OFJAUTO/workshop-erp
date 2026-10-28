"use client";

import { useActionState, useMemo, useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { checkSettlement, CLEARING_LABEL, preTicked, receivedAfter, splitFee, type ClearingMethod } from "@/lib/card-settlement-rules";
import { initialFormState, type FormState } from "@/lib/form-state";

export type SettleRow = { id: string; number: string; method: ClearingMethod; amount: number; estimate: number; receivedAt: string; plate: string; isDeposit: boolean; late: boolean };

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dayText = (iso: string) => new Date(Date.parse(iso)).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/**
 * THE card/link settlement form (27 October 2026): pick the method and the day the bank paid the batch out; the
 * payments received before that day come pre-ticked; type the amount that actually reached the bank and the real
 * fee shows at once, split over the ticked payments in proportion. The result shows right under the button.
 */
export function SettlementForm({ rows, today, initialMethod, canSave, action }: { rows: SettleRow[]; today: string; initialMethod: ClearingMethod; canSave: boolean; action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const [method, setMethod] = useState<ClearingMethod>(initialMethod);
  const [settledOn, setSettledOn] = useState(today);
  const [received, setReceived] = useState("");
  // null = follow the date (pre-ticked); a set = what the person ticked by hand.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  // A recorded settlement empties the box for the next one (the list itself comes back fresh from the server).
  const [seenSuccess, setSeenSuccess] = useState<string | undefined>(undefined);
  if (state.success && state.success !== seenSuccess) {
    setSeenSuccess(state.success);
    setReceived("");
    setPicked(null);
  }
  const mine = useMemo(() => rows.filter((r) => r.method === method), [rows, method]);
  const ticked = useMemo(() => picked ?? new Set(mine.filter((r) => preTicked(r.receivedAt, settledOn)).map((r) => r.id)), [picked, mine, settledOn]);
  // A payment taken after the settlement day can never be in it: shown greyed out, never counted.
  const tickedRows = mine.filter((r) => ticked.has(r.id) && !receivedAfter(r.receivedAt, settledOn));
  const gross = Math.round(tickedRows.reduce((a, r) => a + r.amount, 0) * 100) / 100;
  const receivedNum = received.trim() ? Number(received.replace(/,/g, "")) : null;
  const check = checkSettlement(gross, receivedNum);
  const shares = check.ok ? splitFee(tickedRows.map((r) => ({ id: r.id, amount: r.amount })), check.fee) : new Map<string, number>();
  const estimate = Math.round(tickedRows.reduce((a, r) => a + r.estimate, 0) * 100) / 100;
  const ask = state.values?.ask === "1" && !!state.error;

  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  return (
    <form action={formAction} className="flex flex-col gap-4" data-settlement-form>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-2" role="group" aria-label="Method">
          {(["card", "link"] as const).map((m) => (
            <button key={m} type="button" onClick={() => { setMethod(m); setPicked(null); }} aria-pressed={method === m} data-settle-method={m} className={`min-h-11 rounded-control border-2 px-4 text-sm font-bold ${method === m ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
              {CLEARING_LABEL[m]} ({rows.filter((r) => r.method === m).length})
            </button>
          ))}
        </div>
        <input type="hidden" name="method" value={method} />
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Settlement date (money in the bank)</span>
          <Input name="settled_on" type="date" value={settledOn} max={today} onChange={(e) => { setSettledOn(e.target.value); setPicked(null); }} required className="w-44" data-settle-date />
        </label>
      </div>

      {mine.length ? (
        <ul className="divide-y divide-line rounded-card border border-line bg-white" data-settle-list>
          {mine.map((r) => {
            const after = receivedAfter(r.receivedAt, settledOn);
            const on = ticked.has(r.id) && !after;
            const share = shares.get(r.id);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm" data-settle-row={r.number}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input type="checkbox" name="ids" value={r.id} checked={on} disabled={after} onChange={() => toggle(r.id)} className="h-5 w-5 accent-ink" data-settle-tick={r.number} />
                  <span className="font-bold">{r.number}</span>
                </label>
                <span className="text-muted">{dayText(r.receivedAt)} · {r.plate}{r.isDeposit ? " · deposit" : ""}</span>
                {after ? <span className="text-xs font-semibold text-muted" data-settle-after>Taken after this settlement date</span> : null}
                {r.late ? <span className="rounded-full bg-amber-soft px-2 text-xs font-bold text-amber" data-settle-late>Not settled after 3 working days</span> : null}
                <span className="ml-auto font-extrabold">{aed(r.amount)}</span>
                <span className="w-44 text-right text-xs text-muted">
                  {on && share !== undefined ? <span className="font-semibold text-ink" data-settle-share>fee {aed(share)} (actual)</span> : `est. fee ${aed(r.estimate)}`}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-muted" data-settle-empty>No {CLEARING_LABEL[method].toLowerCase()} payments waiting for a settlement.</p>
      )}

      {mine.length ? (
        <div className="flex flex-col gap-3 rounded-card border-2 border-ink bg-white p-3" data-settle-box>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-muted">Ticked ({tickedRows.length})</span>
              <span className="text-lg font-extrabold" data-settle-gross>{aed(gross)}</span>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Amount actually received (AED)</span>
              <Input name="received" inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} required className="w-40 text-right font-bold" data-settle-received />
            </label>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-muted">Bank fee (actual)</span>
              <span className={`text-lg font-extrabold ${check.askAgain ? "text-amber" : ""}`} data-settle-fee>{check.ok ? `${aed(check.fee)} · ${check.feePercent.toFixed(2)}%` : "—"}</span>
              <span className="text-xs text-muted">estimate was {aed(estimate)}</span>
            </div>
            <label className="flex min-w-48 flex-1 flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Statement line reference</span>
              <Input name="statement_ref" placeholder="As on the bank statement" data-settle-ref />
            </label>
            <label className="flex min-w-48 flex-1 flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Note (optional)</span>
              <Input name="note" />
            </label>
          </div>
          {received.trim() && !check.ok ? <p className="text-sm font-semibold text-red" data-settle-problem>{check.error}</p> : null}
          {check.ok && check.askAgain ? <p className="text-sm font-semibold text-amber" data-settle-warn>{check.askAgain}</p> : null}
          {ask ? <input type="hidden" name="confirmed" value="1" /> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" disabled={!canSave || !check.ok || pending} data-settle-save>
              {pending ? "Saving…" : ask ? "Yes, the figures are right – record it" : "Record the settlement"}
            </Button>
            {!canSave ? <span className="text-sm text-muted">Viewing as someone else: nothing can be recorded.</span> : null}
          </div>
          {state.error ? <Notice tone={ask ? "info" : "error"}>{state.error}</Notice> : null}
          {state.success ? <div data-settle-done><Notice tone="success">{state.success}</Notice></div> : null}
        </div>
      ) : state.success ? (
        <div data-settle-done><Notice tone="success">{state.success}</Notice></div>
      ) : null}
    </form>
  );
}

/** Undo a settlement (wrong amount or wrong ticks): one reason, the answer right under the button. */
export function UndoSettlement({ number, active, action }: { number: string; active: boolean; action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  // Stays mounted on its row after the page refreshes, so the answer is still where the person clicked.
  if (state.success) return <span className="text-xs font-semibold text-green" data-settle-undone>{state.success}</span>;
  if (!active) return null;
  return (
    <details className="relative" data-settle-undo={number}>
      <summary className="inline-flex min-h-9 cursor-pointer items-center rounded-control border border-line-strong bg-white px-3 text-xs font-bold">Undo</summary>
      <form action={formAction} className="absolute right-0 z-20 mt-1 flex w-72 flex-col gap-2 rounded-card border border-line bg-white p-3 shadow-xl">
        <span className="text-xs text-muted">The payments go back to &ldquo;not settled&rdquo; with their estimated fee. If Zoho already has the transfer, the sync page tells the accountant to remove it by hand.</span>
        <Input name="reason" required placeholder="Why? (wrong amount, wrong ticks…)" data-settle-undo-reason />
        <Button type="submit" size="md" tone="secondary" disabled={pending} data-settle-undo-confirm>{pending ? "Undoing…" : `Undo ${number}`}</Button>
        {state.error ? <span className="text-xs font-semibold text-red">{state.error}</span> : null}
      </form>
    </details>
  );
}

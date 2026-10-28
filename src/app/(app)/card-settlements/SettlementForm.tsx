"use client";

import { useActionState, useMemo, useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { feesFor, type FeeRule } from "@/lib/bank-fees";
import { checkFigures, CLEARING_LABEL, preTicked, receivedAfter, splitFigures, vatOnFees, type ClearingMethod } from "@/lib/card-settlement-rules";
import { initialFormState, type FormState } from "@/lib/form-state";

export type SettleRow = { id: string; number: string; method: ClearingMethod; amount: number; estimate: number; est: { msf: number; txn: number; vat: number } | null; authCode: string | null; receivedAt: string; plate: string; isDeposit: boolean; late: boolean };

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fig = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dayText = (iso: string) => new Date(Date.parse(iso)).toLocaleString("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const num = (t: string) => {
  const s = t.trim().replace(/,(?=\d{3}\b)/g, "").replace(",", ".");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * THE card/link settlement form (27 October 2026; 29 October as the accountant asked): pick the method and the day
 * the bank paid the batch out, the payments received before that day come pre-ticked; then ONE row as the bank's
 * statement shows it - ticked total · NET RECEIVED · MSF / BANK FEE · TRANSACTION FEE · VAT 5% (pre-filled as 5% of
 * the fees, editable) · statement reference · note · Record. Ticked must equal net + MSF + fee + VAT: otherwise a red
 * "AED X difference" and the button stays blocked, unless saved anyway with the reason in the note.
 */
export function SettlementForm({ rows, today, initialMethod, canSave, rules, action }: { rows: SettleRow[]; today: string; initialMethod: ClearingMethod; canSave: boolean; rules: Record<ClearingMethod, FeeRule>; action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const [method, setMethod] = useState<ClearingMethod>(initialMethod);
  const [settledOn, setSettledOn] = useState(today);
  const [net, setNet] = useState("");
  const [msf, setMsf] = useState("");
  const [txn, setTxn] = useState("");
  // The VAT follows 5% of the fees until it is typed over.
  const [vatTyped, setVatTyped] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [override, setOverride] = useState(false);
  // null = follow the date (pre-ticked); a set = what the person ticked by hand.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  // A recorded settlement empties the box for the next one (the list itself comes back fresh from the server).
  const [seenSuccess, setSeenSuccess] = useState<string | undefined>(undefined);
  if (state.success && state.success !== seenSuccess) {
    setSeenSuccess(state.success);
    setNet("");
    setMsf("");
    setTxn("");
    setVatTyped(null);
    setNote("");
    setOverride(false);
    setPicked(null);
  }
  const rule = rules[method];
  const mine = useMemo(() => rows.filter((r) => r.method === method), [rows, method]);
  const ticked = useMemo(() => picked ?? new Set(mine.filter((r) => preTicked(r.receivedAt, settledOn)).map((r) => r.id)), [picked, mine, settledOn]);
  // A payment taken after the settlement day can never be in it: shown greyed out, never counted.
  const tickedRows = mine.filter((r) => ticked.has(r.id) && !receivedAfter(r.receivedAt, settledOn));
  const gross = Math.round(tickedRows.reduce((a, r) => a + r.amount, 0) * 100) / 100;
  // The estimate of what the bank will keep, in its own parts (the placeholders).
  const est = tickedRows.reduce((a, r) => { const f = r.est ?? feesFor(r.amount, rule); return { msf: a.msf + f.msf, txn: a.txn + f.txn, vat: a.vat + f.vat }; }, { msf: 0, txn: 0, vat: 0 });
  // Fees typed as the bank prints them ("-175.00") count as plain amounts.
  const msfNum = Math.abs(num(msf) ?? 0);
  const txnNum = Math.abs(num(txn) ?? 0);
  const vatAuto = vatOnFees(msfNum, txnNum, rule?.vatPercent ?? 5);
  const vatNum = vatTyped === null ? vatAuto : Math.abs(num(vatTyped) ?? 0);
  const netNum = num(net);
  const check = checkFigures({ gross, net: netNum, msf: msfNum, txn: txnNum, vat: vatNum });
  const differs = !check.ok && check.difference !== 0;
  const shares = check.ok || (differs && override) ? splitFigures(tickedRows.map((r) => ({ id: r.id, amount: r.amount })), { msf: msfNum, txn: txnNum, vat: vatNum }) : new Map<string, { msf: number; txn: number; vat: number }>();
  const ask = state.values?.ask === "1" && !!state.error;
  const noteOk = note.trim().length >= 5;
  const canRecord = canSave && !pending && tickedRows.length > 0 && netNum !== null && (check.ok || (differs && override && noteOk));

  const toggle = (id: string) => {
    const next = new Set(ticked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };
  const field = (label: string, value: string, set: (v: string) => void, name: string, hook: string, placeholder?: string) => (
    <label className="flex min-w-28 flex-1 flex-col gap-1">
      <span className="text-xs font-semibold uppercase text-muted">{label}</span>
      <Input name={name} inputMode="decimal" value={value} onChange={(e) => set(e.target.value)} placeholder={placeholder} className="text-right font-bold" {...{ [hook]: "" }} />
    </label>
  );

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
            const e = r.est ?? feesFor(r.amount, rule);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm" data-settle-row={r.number}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3">
                  <input type="checkbox" name="ids" value={r.id} checked={on} disabled={after} onChange={() => toggle(r.id)} className="h-5 w-5 accent-ink" data-settle-tick={r.number} />
                  <span className="font-bold">{r.number}</span>
                </label>
                <span className="text-muted">{dayText(r.receivedAt)} · {r.plate}{r.isDeposit ? " · deposit" : ""}{r.authCode ? ` · auth ${r.authCode}` : ""}</span>
                {after ? <span className="text-xs font-semibold text-muted" data-settle-after>Taken after this settlement date</span> : null}
                {r.late ? <span className="rounded-full bg-amber-soft px-2 text-xs font-bold text-amber" data-settle-late>Not settled after 3 working days</span> : null}
                <span className="ml-auto font-extrabold">{aed(r.amount)}</span>
                <span className="w-60 text-right text-xs text-muted">
                  {on && share ? <span className="font-semibold text-ink" data-settle-share>MSF {fig(share.msf)} + fee {fig(share.txn)} + VAT {fig(share.vat)} (actual)</span> : `est. MSF ${fig(e.msf)} + fee ${fig(e.txn)} + VAT ${fig(e.vat)}`}
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
          <div className="flex flex-wrap items-end gap-3" data-settle-figures>
            <div className="flex min-w-32 flex-col">
              <span className="text-xs font-semibold uppercase text-muted">Ticked total ({tickedRows.length})</span>
              <span className="min-h-11 text-lg font-extrabold leading-[2.75rem]" data-settle-gross>{aed(gross)}</span>
            </div>
            {field("Net received", net, setNet, "net", "data-settle-net")}
            {field("MSF / bank fee", msf, setMsf, "msf", "data-settle-msf", `est. ${fig(est.msf)}`)}
            {field("Transaction fee", txn, setTxn, "txn", "data-settle-txn", `est. ${fig(est.txn)}`)}
            <label className="flex min-w-28 flex-1 flex-col gap-1">
              <span className="text-xs font-semibold uppercase text-muted">VAT {rule?.vatPercent ?? 5}%</span>
              <Input name="vat" inputMode="decimal" value={vatTyped ?? (msf || txn ? fig(vatAuto) : "")} onChange={(e) => setVatTyped(e.target.value)} placeholder={`est. ${fig(est.vat)}`} className="text-right font-bold" data-settle-vat />
            </label>
            <label className="flex min-w-40 flex-1 flex-col gap-1">
              <span className="text-xs font-semibold uppercase text-muted">Statement reference</span>
              <Input name="statement_ref" placeholder="As on the bank statement" data-settle-ref />
            </label>
            <label className="flex min-w-40 flex-1 flex-col gap-1">
              <span className="text-xs font-semibold uppercase text-muted">Note</span>
              <Input name="note" value={note} onChange={(e) => setNote(e.target.value)} data-settle-note />
            </label>
            <Button type="submit" size="lg" disabled={!canRecord} data-settle-save>
              {pending ? "Saving…" : ask ? "Yes, the figures are right – record it" : differs && override ? "Save anyway" : "Record the settlement"}
            </Button>
          </div>
          {check.ok ? (
            <p className={`text-sm font-semibold ${check.askAgain ? "text-amber" : "text-green"}`} data-settle-adds>
              {aed(gross)} = net {fig(netNum ?? 0)} + MSF {fig(msfNum)} + fee {fig(txnNum)} + VAT {fig(vatNum)} ✓ · the jobs&apos; cost {fig(check.cost)} (the VAT is reclaimable){check.askAgain ? ` · ${check.askAgain}` : ""}
            </p>
          ) : differs ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-extrabold text-red" data-settle-diff>AED {Math.abs(check.difference).toFixed(2)} difference</p>
              <p className="text-xs text-red">{check.error}</p>
              <label className="flex min-h-11 items-center gap-3 text-sm font-semibold" data-settle-override>
                <input type="checkbox" name="override" value="1" checked={override} onChange={(e) => setOverride(e.target.checked)} className="h-5 w-5 accent-ink" />
                Save anyway: the difference is explained in the note (written in the change log)
              </label>
              {override && !noteOk ? <p className="text-xs font-semibold text-amber" data-settle-need-note>Write the reason in the note first.</p> : null}
            </div>
          ) : net.trim() ? (
            <p className="text-sm font-semibold text-red" data-settle-problem>{check.error}</p>
          ) : null}
          {vatTyped !== null ? <input type="hidden" name="vat_typed" value="1" /> : null}
          {ask ? <input type="hidden" name="confirmed" value="1" /> : null}
          {!canSave ? <span className="text-sm text-muted">Viewing as someone else: nothing can be recorded.</span> : null}
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
        <span className="text-xs text-muted">The payments go back to &ldquo;not settled&rdquo; with their estimated fee. If Zoho already has the entries, the sync page tells the accountant to remove them by hand.</span>
        <Input name="reason" required placeholder="Why? (wrong amount, wrong ticks…)" data-settle-undo-reason />
        <Button type="submit" size="md" tone="secondary" disabled={pending} data-settle-undo-confirm>{pending ? "Undoing…" : `Undo ${number}`}</Button>
        {state.error ? <span className="text-xs font-semibold text-red">{state.error}</span> : null}
      </form>
    </details>
  );
}

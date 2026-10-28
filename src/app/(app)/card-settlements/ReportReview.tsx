"use client";

import { Fragment, useActionState, useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { initialFormState, type FormState } from "@/lib/form-state";
import type { LineMatch, ParsedReport } from "@/lib/settlement-report";

export type ReviewPaymentOption = { id: string; number: string; method: string; amount: number; receivedDay: string; authCode: string | null; plate: string };

const fig = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const day = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");
const METHOD = { card: "Card machine", link: "Payment link" } as const;

/** Upload the bank's report: PDF, CSV or Excel; the answer shows right under the button. */
export function ReportUpload({ action, canSave }: { action: (s: FormState, f: FormData) => Promise<FormState>; canSave: boolean }) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  return (
    <form action={formAction} className="flex flex-col gap-2" data-report-upload>
      <div className="flex flex-wrap items-center gap-3">
        <input type="file" name="report" accept=".pdf,.csv,.xlsx,.xls,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" required className="min-h-11 w-full max-w-96 rounded-control border border-line-strong bg-white px-3 py-2 text-sm file:mr-3 file:rounded-control file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white" data-report-file />
        <Button type="submit" size="md" disabled={!canSave || pending} data-report-upload-button>{pending ? "Reading…" : "Upload settlement report"}</Button>
      </div>
      <span className="text-xs text-muted">Network International&apos;s Merchant Transaction Report, as PDF, CSV or Excel - the payment link and the card machine alike. Nothing is recorded until you check the lines and press Record.</span>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
    </form>
  );
}

/**
 * THE report review (29 October 2026): every line with its match - matched ✓ (auth + amount + date), or picked by
 * hand, or "not ours" - the summary, every red flag (adjustments, chargebacks, suspended, refunds, lines that do not
 * add up), and the check that the lines add up to the net payable. Record makes one settlement per method with each
 * payment's exact MSF, fee and VAT.
 */
export function ReportReview({ report, matches, payments, today, recorded, canSave, action }: { report: ParsedReport & { fileName: string }; matches: LineMatch[]; payments: ReviewPaymentOption[]; today: string; recorded: boolean; canSave: boolean; action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const [picks, setPicks] = useState<Record<number, string>>(() => Object.fromEntries(matches.map((m) => [m.index, m.paymentId ?? ""])));
  const [seen, setSeen] = useState(false);
  const h = report.header;
  const s = report.summary;
  const red = report.flags.filter((f) => f.tone === "red");
  const byId = new Map(payments.map((p) => [p.id, p]));
  const open = report.lines.filter((l) => l.kind === "sale" && !picks[l.index]).length;
  const done = !!state.success || recorded;
  return (
    <form action={formAction} className="flex flex-col gap-4" data-report-review>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm" data-report-header>
        <span className="font-bold">{report.fileName}</span>
        <span>Period {day(h.from)} – {day(h.to)}</span>
        {h.date ? <span>Report date {day(h.date)}</span> : null}
        {h.merchantNo ? <span className="text-muted">Merchant no. {h.merchantNo}</span> : null}
        {h.chainId ? <span className="text-muted">Chain ID {h.chainId}</span> : null}
      </div>

      <div className="overflow-x-auto rounded-card border border-line">
        <table className="w-full min-w-[46rem] text-sm" data-report-lines>
          <thead className="bg-chip text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-2 py-2">Date</th><th className="px-2 py-2">Terminal</th><th className="px-2 py-2">Card</th><th className="px-2 py-2">Type</th><th className="px-2 py-2">Auth</th>
              <th className="px-2 py-2 text-right">Amount</th><th className="px-2 py-2 text-right">MSF</th><th className="px-2 py-2 text-right">Fee</th><th className="px-2 py-2 text-right">VAT</th><th className="px-2 py-2 text-right">Net</th>
              <th className="px-2 py-2">Method</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {report.lines.map((l) => {
              const m = matches.find((x) => x.index === l.index);
              const pick = picks[l.index] ?? "";
              const picked = pick && pick !== "none" ? byId.get(pick) : null;
              const options = [...(m?.candidates ?? []).map((id) => byId.get(id)).filter((p): p is ReviewPaymentOption => !!p), ...payments.filter((p) => (!l.method || p.method === l.method) && !(m?.candidates ?? []).includes(p.id))];
              const rowTone = l.kind !== "sale" || !l.adds ? "bg-red-soft" : "";
              return (
                <Fragment key={l.index}>
                <tr className={rowTone} data-report-line={l.index} data-report-auth={l.authCode ?? ""}>
                  <td className="px-2 py-2 whitespace-nowrap">{day(l.date)}</td>
                  <td className="px-2 py-2">{l.terminal ?? "–"}</td>
                  <td className="px-2 py-2 whitespace-nowrap" title={l.card ?? ""}>{l.card ? `…${l.card.slice(-4)}` : "–"}</td>
                  <td className={`px-2 py-2 ${l.kind !== "sale" ? "font-bold text-red" : ""}`}>{l.type}</td>
                  <td className="px-2 py-2 font-mono">{l.authCode ?? "–"}</td>
                  <td className="px-2 py-2 text-right font-bold">{fig(l.amount)}</td>
                  <td className="px-2 py-2 text-right">{fig(l.msf)}</td>
                  <td className="px-2 py-2 text-right">{fig(l.txn)}</td>
                  <td className="px-2 py-2 text-right">{fig(l.vat)}</td>
                  <td className="px-2 py-2 text-right font-bold">{fig(l.net)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{l.method ? METHOD[l.method] : "unknown"}{l.methodBy === "description" ? <span className="block text-xs text-muted">from {l.desp}</span> : null}</td>
                </tr>
                <tr className={`${rowTone} border-t-0`} data-report-line-match={l.index}>
                  <td colSpan={11} className="px-2 pb-3 pt-0" data-report-status={l.kind !== "sale" ? "flagged" : pick === "none" ? "not_ours" : pick && m?.paymentId === pick ? "matched" : pick ? "picked" : "unmatched"}>
                    {l.kind !== "sale" ? (
                      <span className="text-xs font-bold text-red">Not a sale: settle with the bank by hand</span>
                    ) : done ? (
                      <span className="text-xs font-semibold">{picked ? `${picked.number} · ${picked.plate}` : "Not ours"}</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {pick && m?.paymentId === pick ? <span className="text-xs font-bold text-green" data-report-matched>Matched ✓ {picked?.number} · {picked?.plate}</span> : !pick ? <span className="text-xs font-semibold text-amber">{m?.why ?? "Not matched"}</span> : null}
                        <select value={pick} onChange={(e) => setPicks((x) => ({ ...x, [l.index]: e.target.value }))} className="min-h-11 w-full max-w-md rounded-control border border-line-strong bg-white px-2 text-sm" data-report-pick={l.index}>
                          <option value="">Pick the payment…</option>
                          {options.map((p) => <option key={p.id} value={p.id}>{p.number} · AED {fig(p.amount)} · {p.plate}{p.authCode ? ` · auth ${p.authCode}` : ""}</option>)}
                          <option value="none">Not ours</option>
                        </select>
                      </div>
                    )}
                    <input type="hidden" name={`pick_${l.index}`} value={pick} />
                  </td>
                </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4" data-report-summary>
        <span>POS transactions: {s.posCount ?? "–"} · AED {fig(s.posValue)}</span>
        <span>Commission: {fig(s.commission)}</span>
        <span>Fee transactions: {fig(s.feeTransactions)}</span>
        <span>VAT: {fig(s.vat)}</span>
        <span className={s.adjustments ? "font-bold text-red" : ""}>Adjustments: {fig(s.adjustments)}</span>
        <span className={s.chargebacks ? "font-bold text-red" : ""}>Chargebacks: {fig(s.chargebacks)}</span>
        <span className={s.suspended ? "font-bold text-red" : ""}>Suspended: {fig(s.suspended)}</span>
        <span>Rebates: {fig(s.rebates)}</span>
        <span>BNPL / instalment fees: {fig(s.instalmentFees)}</span>
        <span className="font-extrabold">Net payable: AED {fig(s.netPayable)}</span>
      </div>
      <p className={`text-sm font-semibold ${report.totals.agrees ? "text-green" : "text-red"}`} data-report-check>
        Lines: AED {fig(report.totals.gross)} − MSF {fig(report.totals.msf)} − fee {fig(report.totals.txn)} − VAT {fig(report.totals.vat)} = net AED {fig(report.totals.net)}
        {report.totals.agrees ? " = the net payable ✓" : report.totals.agrees === false ? ` ≠ the net payable AED ${fig(report.totals.netPayable)}` : " (the net payable could not be read)"}
      </p>
      {report.flags.length ? (
        <ul className="flex flex-col gap-1 text-sm" data-report-flags>
          {report.flags.map((f, i) => <li key={i} className={`font-semibold ${f.tone === "red" ? "text-red" : "text-amber"}`} data-report-flag={f.tone}>{f.tone === "red" ? "⚠ " : ""}{f.text}</li>)}
        </ul>
      ) : null}

      {done ? (
        state.success ? <div data-report-done><Notice tone="success">{state.success}</Notice></div> : <Notice tone="info">This report was recorded.</Notice>
      ) : (
        <div className="flex flex-wrap items-end gap-3 rounded-card border-2 border-ink bg-white p-3" data-report-record-box>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Settlement date (money in the bank)</span>
            <Input name="settled_on" type="date" defaultValue={h.date && h.date <= today ? h.date : today} max={today} required className="w-44" data-report-date />
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Statement reference</span>
            <Input name="statement_ref" placeholder="As on the bank statement" data-report-ref />
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Note (optional)</span>
            <Input name="note" />
          </label>
          {red.length ? (
            <label className="flex min-h-11 w-full items-center gap-3 text-sm font-semibold text-red" data-report-flags-seen>
              <input type="checkbox" name="flags_seen" value="1" checked={seen} onChange={(e) => setSeen(e.target.checked)} className="h-5 w-5 accent-ink" />
              I have checked the red items above with the bank
            </label>
          ) : null}
          <Button type="submit" size="lg" disabled={!canSave || pending || open > 0 || (red.length > 0 && !seen)} data-report-record>{pending ? "Recording…" : open ? `${open} line${open === 1 ? "" : "s"} still to match` : "Record the settlement"}</Button>
          {state.error ? <div className="w-full"><Notice tone="error">{state.error}</Notice></div> : null}
        </div>
      )}
    </form>
  );
}

"use client";

import { Fragment, useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Notice } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { initialFormState, type FormState } from "@/lib/form-state";
import { realAuthCode } from "@/lib/auth-code";
import { reloadIfStale } from "@/lib/app-version";
import type { LineMatch, ParsedReport } from "@/lib/settlement-report";
import { confirmSuggestionAction } from "./actions";
import { MoneyDate } from "@/components/MoneyDate";

export type ReviewPaymentOption = { id: string; number: string; method: string; amount: number; receivedDay: string; authCode: string | null; codeMissing?: boolean; settledIn?: string | null; plate: string };

/** The pick of a line whose payment was settled by hand before: handled, never settled twice. */
const SETTLED = "settled:";

const fig = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
// A date stored before the reader checked the calendar ("2026-24-10") shows as it is, never "Invalid Date".
const day = (d: string | null) => (!d ? "–" : Number.isFinite(Date.parse(`${d}T12:00:00Z`)) ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : d);
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
export function ReportReview({ reportId, report, matches, payments, today, recorded, canSave, action }: { reportId: string; report: ParsedReport & { fileName: string }; matches: LineMatch[]; payments: ReviewPaymentOption[]; today: string; recorded: boolean; canSave: boolean; action: (s: FormState, f: FormData) => Promise<FormState> }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(action, initialFormState);
  // A suggested match is not picked until accounts confirm it; a payment settled by hand before is handled already.
  const [picks, setPicks] = useState<Record<number, string>>(() => Object.fromEntries(matches.map((m) => [m.index, m.status === "settled" && m.paymentId ? `${SETTLED}${m.paymentId}` : m.status === "suggested" ? "" : (m.paymentId ?? "")])));
  const [confirming, setConfirming] = useState<number | null>(null);
  const [answers, setAnswers] = useState<Record<number, { ok?: boolean; error?: string; message?: string }>>({});
  // "Confirm": the bank's code is saved on the payment whose code was missing; the line becomes Matched (or Already settled).
  const confirmSuggestion = async (m: LineMatch) => {
    if (!m.paymentId) return;
    setConfirming(m.index);
    const r = await confirmSuggestionAction(reportId, m.index, m.paymentId).catch((e) => ({ error: reloadIfStale(e) ? "A new version is loading – tap Confirm again in a moment." : "No connection – try again." }) as { ok?: boolean; error?: string; message?: string; settledIn?: string | null });
    setConfirming(null);
    setAnswers((x) => ({ ...x, [m.index]: r }));
    if (r.ok && m.paymentId) {
      const id = m.paymentId;
      setPicks((x) => ({ ...x, [m.index]: r.settledIn ? `${SETTLED}${id}` : id }));
      router.refresh();
    }
  };
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
              const settledPick = pick.startsWith(SETTLED);
              const picked = pick && pick !== "none" ? byId.get(settledPick ? pick.slice(SETTLED.length) : pick) : null;
              // Payments settled before are never offered to settle again: one that fits the line (its code missing) is
              // offered as "already settled" - picked, the line counts as handled and the bank's code is saved on it.
              const cands = m?.candidates ?? [];
              const options = [...cands.map((id) => byId.get(id)).filter((p): p is ReviewPaymentOption => !!p), ...payments.filter((p) => (!l.method || p.method === l.method) && !cands.includes(p.id))].filter((p) => !p.settledIn || cands.includes(p.id));
              const lineCode = realAuthCode(l.authCode);
              const answer = answers[l.index];
              // Matched: auth + amount + date, or a suggestion just confirmed (the code is saved on it).
              const exact = !!pick && m?.paymentId === pick && (m.status === "matched" || !!answer?.ok);
              const willFill = !!picked && !!picked.codeMissing && !!lineCode && !answer?.ok && !payments.some((p) => p.authCode === lineCode);
              // Settled by an exact match or a confirmed suggestion: nothing to choose. Picked by hand: the choice stays open.
              const settledAuto = settledPick && (m?.status === "settled" || !!answer?.ok);
              const status = l.kind !== "sale" ? "flagged" : pick === "none" ? "not_ours" : settledPick ? "settled" : exact ? "matched" : pick ? "picked" : m?.status === "suggested" ? "suggested" : "unmatched";
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
                  <td colSpan={11} className="px-2 pb-3 pt-0" data-report-status={status}>
                    {l.kind !== "sale" ? (
                      <span className="text-xs font-bold text-red">Not a sale: settle with the bank by hand</span>
                    ) : done ? (
                      <span className="text-xs font-semibold">{picked ? `${picked.number} · ${picked.plate}${settledPick ? ` · already settled in ${picked.settledIn}` : ""}` : "Not ours"}</span>
                    ) : settledAuto ? (
                      <span className="text-xs font-bold text-green" data-report-settled={l.index}>Already settled in {picked?.settledIn ?? "a settlement"} ✓ {picked?.number} · {picked?.plate}{answer?.ok ? ` · ${answer.message}` : ""}</span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {exact ? <span className="text-xs font-bold text-green" data-report-matched>Matched ✓ {picked?.number} · {picked?.plate}{answer?.ok ? ` · ${answer.message}` : ""}</span> : settledPick ? <span className="w-full text-xs font-bold text-green" data-report-settled-pick={l.index}>Already settled in {picked?.settledIn ?? "a settlement"} ✓ {picked?.number} · {picked?.plate}: nothing new is recorded for this line.</span> : !pick && m?.status !== "suggested" ? <span className="text-xs font-semibold text-amber">{m?.why ?? "Not matched"}</span> : null}
                        {!pick && m?.status === "suggested" && m.paymentId ? (
                          // 3 November 2026: a payment saved with its auth code missing fits this line - one tap saves the bank's code on it.
                          // Words above the button: on a narrow screen the table scrolls sideways, and the button must stay in sight.
                          <span className="flex w-full max-w-xl flex-col items-start gap-2 rounded-control border-2 border-amber-bar bg-amber-soft p-2" data-report-suggested={l.index}>
                            <span className="text-xs font-semibold">{m.why}</span>
                            <Button type="button" size="md" disabled={!canSave || confirming === l.index} onClick={() => void confirmSuggestion(m)} className="!whitespace-normal" data-report-confirm-suggested={l.index}>
                              {confirming === l.index ? "Saving…" : `Confirm – save auth ${m.fillCode ?? ""} on ${byId.get(m.paymentId)?.number ?? "it"}`}
                            </Button>
                            {answer?.error ? <span className="w-full text-xs font-semibold text-red" data-report-confirm-error>{answer.error}</span> : null}
                          </span>
                        ) : null}
                        <select value={pick} onChange={(e) => setPicks((x) => ({ ...x, [l.index]: e.target.value }))} className="min-h-11 w-full max-w-md rounded-control border border-line-strong bg-white px-2 text-sm" data-report-pick={l.index}>
                          <option value="">{m?.status === "suggested" ? "Or pick another payment…" : "Pick the payment…"}</option>
                          {options.map((p) => <option key={p.id} value={p.settledIn ? `${SETTLED}${p.id}` : p.id}>{p.number} · AED {fig(p.amount)} · {p.plate}{p.authCode ? ` · auth ${p.authCode}` : p.codeMissing ? " · auth missing" : ""}{p.settledIn ? ` · already settled in ${p.settledIn}` : ""}</option>)}
                          <option value="none">Not ours</option>
                        </select>
                        {willFill ? <span className="w-full text-xs font-semibold text-amber-bar" data-report-will-fill={l.index}>Auth {lineCode} will be saved on {picked?.number} when you record (its code is missing).</span> : null}
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
          <MoneyDate name="settled_on" label="In bank on (money in the bank)" defaultValue={h.date && h.date <= today ? h.date : ""} max={today} hook="data-report-date" />
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
          <ConfirmSubmit
            label={pending ? "Recording…" : open ? `${open} line${open === 1 ? "" : "s"} still to match` : "Record the settlement"}
            disabled={!canSave || pending || open > 0 || (red.length > 0 && !seen)}
            title="Record the settlement from the bank report?"
            lines={[`The report's figures: AED ${fig(report.totals.gross)} − MSF ${fig(report.totals.msf)} − fee ${fig(report.totals.txn)} − VAT ${fig(report.totals.vat)} = net AED ${fig(report.totals.net)}`, "each matched payment gets its actual bank fee and it goes to Zoho Books"]}
            live={[{ label: "settled on", field: "settled_on" }, { label: "statement ref", field: "statement_ref", empty: "no statement reference" }]}
            confirmLabel="Yes, record the settlement"
            hook="report-settlement"
            attrs={{ "data-report-record": "" }}
          />
          {state.error ? <div className="w-full"><Notice tone="error">{state.error}</Notice></div> : null}
        </div>
      )}
    </form>
  );
}

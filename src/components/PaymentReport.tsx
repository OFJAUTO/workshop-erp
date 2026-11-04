"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Textarea } from "@/components/ui";
import { ReleaseFormLock } from "@/components/forms";
import { AuthCodeInput } from "@/components/AuthCodeInput";
import { ReasonChips } from "@/components/ReasonChips";
import { ViewerThumb } from "@/components/PhotoViewer";
import { QueuedProofUpload } from "@/components/QueuedProofUpload";
import { JobFileUpload, spendFormKey, useFormKey, type FilesWaiting, type JobFile } from "@/components/JobFileUpload";
import { openRecordPayment } from "@/components/RecordPaymentHost";
import { queryPaymentReportAction, reportPaymentAction, withdrawPaymentReportAction } from "@/app/(app)/jobs/[id]/payment-report-actions";
import { needsAuthCode } from "@/lib/auth-code";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "@/lib/money-steps";
import { firstName, methodWord, REPORT_NOTE_MAX, REPORT_QUERY_MIN, slipKind } from "@/lib/payment-report-rules";
import type { PaymentReport } from "@/lib/payment-reports";
import { DEFAULT_REASONS } from "@/lib/reasons";

/**
 * PAYMENT HAND-OVER (2 November 2026, section 3; J-00969). The screens of "Payment received – send to accounts": the
 * advisor's window (amount pre-filled with the balance, the method, the auth code or reference if he has it, the photo of
 * the slip, receipt or transfer - required - and a note), the report's line on the job card and the money page, and the
 * Record / Query buttons accounts and the owner use (on those lines and on Waiting on you). Advisors never record money.
 */

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const timeOf = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });

/** The advisor's button and window. `replaces` = sending a queried report again (its details and photo carried over). */
export function PaymentReportButton({ jobId = null, estimateId = null, balance, expected = null, replaces = null, label = "Payment received – send to accounts", size = "md", tone = "secondary", className = "" }: { jobId?: string | null; /** A report on an ESTIMATE before the car arrives (4 November 2026): the slip goes with the estimate. */ estimateId?: string | null; balance: number | null; expected?: string | null; replaces?: PaymentReport | null; label?: string; size?: "md" | "lg"; tone?: "primary" | "secondary"; className?: string }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(0);
  return (
    <>
      <Button type="button" size={size} tone={tone} className={`!whitespace-normal ${className}`} onClick={() => { setN((x) => x + 1); setOpen(true); }} data-payment-report-open={replaces ? "again" : "new"}>
        {label}
      </Button>
      {open ? <ReportDialog key={n} jobId={jobId} estimateId={estimateId} balance={balance} expected={expected} replaces={replaces} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function ReportDialog({ jobId = null, estimateId = null, balance, expected, replaces, onClose }: { jobId?: string | null; estimateId?: string | null; balance: number | null; expected: string | null; replaces: PaymentReport | null; onClose: () => void }) {
  const router = useRouter();
  const place = jobId ?? estimateId ?? "";
  const tag = `payreport:${place}`;
  const { key } = useFormKey(tag, place);
  // An estimate's slip goes to its own place (no job yet): sent by THE queue, Send works once it has arrived.
  const [estSlip, setEstSlip] = useState(false);
  const [method, setMethod] = useState<string>(replaces?.method ?? (expected && (PAYMENT_METHODS as readonly string[]).includes(expected) ? expected : "card"));
  const [authCode, setAuthCode] = useState(replaces?.authCode ?? "");
  const [reference, setReference] = useState(replaces?.reference ?? "");
  const [note, setNote] = useState(replaces?.note ?? "");
  const [photos, setPhotos] = useState<{ key: string | null; files: JobFile[] }>({ key: null, files: [] });
  if (photos.key !== key) setPhotos({ key, files: [] });
  const mine = photos.key === key ? photos.files : [];
  const [wait, setWait] = useState<FilesWaiting>({ count: 0, stopped: 0 });
  const [state, action, pending] = useActionState(reportPaymentAction, null);
  const [errorSeen, setErrorSeen] = useState<number | undefined>(undefined);
  const carried = replaces && !mine.length ? replaces.photos : [];
  const hasPhoto = jobId ? mine.length > 0 || carried.length > 0 : estSlip || carried.length > 0;
  const sent = !!state?.ok;
  // The report is made: the key it was sent with is spent (only that one - the new key is never spent again), so the
  // next report on this car starts with a new one. A key already used for ANOTHER payment (a copied tab) is spent too:
  // the server sent nothing, the photo is attached again under the new key.
  const sentKey = useRef<string | null>(null);
  useEffect(() => {
    if (!sentKey.current || !(state?.ok || state?.renewKey)) return;
    spendFormKey(tag, sentKey.current);
    sentKey.current = null;
    if (state?.ok) router.refresh();
  }, [state, tag, router]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const photoLine = hasPhoto ? null : wait.stopped ? "The photo could not be sent – try again or remove it, then attach it again." : wait.count ? "The photo is still sending – Send works once it has arrived." : "Attach the photo of the slip, receipt or transfer (required).";
  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-ink/60 p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Payment received – send to accounts" data-payment-report-dialog>
      <div className="w-full max-w-lg rounded-card bg-white p-5 shadow-xl flex flex-col gap-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <h2 className="text-lg font-extrabold">{replaces ? "Send the payment again" : "Payment received – send to accounts"}</h2>
            <p className="text-xs text-muted">Accounts record it and you are told. You do not record money yourself.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 shrink-0 rounded-control border border-line-strong text-lg font-bold" data-payment-report-close>✕</button>
        </div>
        {sent ? (
          <div className="flex flex-col gap-3 rounded-control border-2 border-green bg-green-soft p-4" data-report-sent>
            <p className="text-lg font-extrabold text-green">Sent to accounts ✓</p>
            <p className="text-sm">{state?.told?.length ? `${state.told.join(" and ")} ${state.told.length === 1 ? "is" : "are"} told; the job card shows it in amber until it is recorded.` : "Accounts and the owner are told; the job card shows it in amber until it is recorded."}</p>
            <div><Button type="button" size="md" onClick={onClose} data-report-done>Done</Button></div>
          </div>
        ) : (
          <form action={action} onSubmit={() => { sentKey.current = key; }} className="flex flex-col gap-3" data-report-form>
            {jobId ? <input type="hidden" name="job_id" value={jobId} /> : null}
            {estimateId ? <input type="hidden" name="estimate_id" value={estimateId} /> : null}
            <input type="hidden" name="report_id" value={key ?? ""} />
            <input type="hidden" name="method" value={method} />
            {replaces ? <input type="hidden" name="replaces_id" value={replaces.id} /> : null}
            {replaces?.queryNote ? <p className="rounded-control border border-red-bar bg-red-soft p-2 text-sm" data-report-query-shown>Query from {firstName(replaces.queriedBy)}: {replaces.queryNote}</p> : null}
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Amount received (AED){balance !== null && balance > 0 ? ` · balance ${aed(balance)}` : ""}</span>
              <Input name="amount" inputMode="decimal" required defaultValue={replaces ? replaces.amount.toFixed(2) : balance !== null && balance > 0 ? balance.toFixed(2) : ""} className="max-w-56" data-report-amount />
            </label>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">How did the customer pay?</span>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {PAYMENT_METHODS.map((m) => (
                  <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m} data-report-method={m} className={`min-h-12 rounded-control border-2 px-1 text-sm font-bold ${method === m ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                    {PAYMENT_METHOD_LABELS[m] ?? m}
                  </button>
                ))}
              </div>
            </div>
            {needsAuthCode(method) ? (
              <AuthCodeInput method={method} value={authCode} onChange={setAuthCode} />
            ) : method === "cash" ? null : (
              <Input name="reference" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder={method === "cheque" ? "Cheque number and bank (optional)" : "Transfer reference (optional)"} className="max-w-sm" data-report-reference />
            )}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Photo of the {method === "card" ? "card slip" : method === "transfer" ? "transfer (screenshot or photo)" : method === "cheque" ? "cheque" : method === "link" ? "payment confirmation" : "receipt"} (required)</span>
              {key && jobId ? (
                <JobFileUpload
                  jobId={jobId}
                  kind="payment_report"
                  refId={key}
                  form={{ tag, key }}
                  files={mine}
                  accept="any"
                  label="Take photo / attach"
                  compact
                  removable
                  onAdded={(f) => {
                    setPhotos((s) => (f.refId === s.key && !s.files.some((x) => x.id === f.id) ? { ...s, files: [...s.files, f] } : s));
                    // A photo arrived: an earlier answer ("Attach the photo first") no longer stands.
                    setErrorSeen(state?.at ?? 0);
                  }}
                  onRemoved={(f) => setPhotos((s) => ({ ...s, files: s.files.filter((x) => x.id !== f.id) }))}
                  onPending={setWait}
                />
              ) : key && estimateId ? (
                <QueuedProofUpload key={key} target="estimate_report" scopeId={estimateId} extraFields={{ reportId: key }} onSent={() => { setEstSlip(true); setErrorSeen(state?.at ?? 0); }} label="Take photo / attach" data-report-estimate-slip="1" />
              ) : null}
              {carried.length ? <span className="text-xs text-muted" data-report-photo-carried>The first photo goes with it ({carried.length}); add a clearer one if accounts asked for it.</span> : null}
              {photoLine ? <span className="text-xs font-semibold text-amber-bar" data-report-photo-missing>{photoLine}</span> : null}
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Note for accounts (optional)</span>
              <Textarea name="note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={REPORT_NOTE_MAX} placeholder="e.g. paid at the counter by the customer's driver" className="min-h-16" data-report-note />
            </label>
            {state?.ask === "second" && state.askWords ? (
              <div className="flex flex-col gap-2 rounded-control border-2 border-amber-bar bg-amber-soft p-3" data-report-second>
                <ReleaseFormLock key={state.at} />
                <p className="text-sm font-semibold">{state.askWords}</p>
                <div><Button type="submit" name="confirm_second" value="1" size="md" data-report-send-anyway>Send it as well</Button></div>
              </div>
            ) : null}
            {state?.error && state.at !== errorSeen ? <p className="text-sm font-semibold text-red" data-report-error>{state.error}<ReleaseFormLock key={state.at} /></p> : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="lg" disabled={!key || !hasPhoto || pending} data-report-send>{pending ? "Sending…" : "Send to accounts"}</Button>
              <span className="text-xs text-muted">Accounts and the owner are told at once.</span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

/** Accounts or the owner send a report back to the advisor with a comment (on the job card, Waiting on you, the window). */
export function PaymentReportQuery({ reportId, onDone, disabled = false, size = "md", reasons = DEFAULT_REASONS.payment_query }: { reportId: string; onDone?: () => void; disabled?: boolean; size?: "md" | "lg"; /** The one-tap reasons (Settings > reasons, "Accounts query a payment an advisor sent"). */ reasons?: readonly string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(queryPaymentReportAction, null);
  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onDone?.();
    }
  }, [state, router, onDone]);
  if (state?.ok) return <span className="text-xs font-bold text-red" data-report-queried-done>Queried – the advisor is told.</span>;
  return (
    <>
      <Button type="button" size={size} tone="secondary" disabled={disabled} title={disabled ? "View as is read-only – use Act as to query" : undefined} onClick={() => setOpen(true)} data-report-query-open={reportId}>
        Query
      </Button>
      {open ? (
        <div className="fixed inset-0 z-[60] flex items-start sm:items-center justify-center bg-ink/60 p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Query the payment" data-report-query-dialog>
          <form action={action} className="w-full max-w-md rounded-card bg-white p-5 shadow-xl flex flex-col gap-3 max-h-[calc(100dvh-2rem)] overflow-y-auto">
            <input type="hidden" name="report_id" value={reportId} />
            <h2 className="text-lg font-extrabold">Query it back to the advisor</h2>
            <ReasonChips name="note" options={reasons} rows={2} required placeholder="What is wrong? The advisor reads this." inputClassName="min-h-16" />
            {state?.error ? <p className="text-sm font-semibold text-red" data-report-query-error>{state.error}<ReleaseFormLock key={state.at} /></p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="md" disabled={pending} data-report-query-send>{pending ? "Sending…" : "Send the query"}</Button>
              <Button type="button" size="md" tone="secondary" onClick={() => setOpen(false)} data-report-query-cancel>Go back</Button>
            </div>
            <p className="text-xs text-muted">At least {REPORT_QUERY_MIN} letters. The report leaves your list; the advisor sends it again or withdraws it.</p>
          </form>
        </div>
      ) : null}
    </>
  );
}

/** The advisor who sent it (or the owner) takes it back. */
function WithdrawReport({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(withdrawPaymentReportAction, null);
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  if (state?.ok) return <span className="text-xs text-muted">Withdrawn.</span>;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="min-h-11 px-2 text-xs font-bold underline underline-offset-4" data-report-withdraw={reportId}>Withdraw</button>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" data-report-withdraw-form>
      <input type="hidden" name="report_id" value={reportId} />
      <Input name="reason" placeholder="Why? (optional)" className="max-w-56" />
      <Button type="submit" size="md" tone="secondary" disabled={pending} data-report-withdraw-yes>Yes, withdraw</Button>
      <button type="button" onClick={() => setOpen(false)} className="min-h-11 px-2 text-xs font-bold underline underline-offset-4">Keep it</button>
      {state?.error ? <span className="text-xs font-semibold text-red">{state.error}<ReleaseFormLock key={state.at} /></span> : null}
    </form>
  );
}

/**
 * THE slip of a report, wherever it shows (the job card line, Waiting on you, the reports card, the Record payment
 * window): a photo opens in the viewer, a PDF (a bank's transfer confirmation) opens in a new tab, a video plays in the
 * viewer. Never a broken picture.
 */
export function SlipTile({ url, thumb = null, contentType = null, path = null, label, hook, size = "h-11 w-11" }: { url: string | null; thumb?: string | null; contentType?: string | null; path?: string | null; label: string; /** data-report-photo (the report's id). */ hook: string; size?: string }) {
  if (!url) return null;
  const kind = slipKind(contentType, path);
  const box = `shrink-0 ${size} overflow-hidden rounded-control border border-line`;
  if (kind === "pdf") {
    return (
      <a href={url} target="_blank" rel="noreferrer" aria-label={`Open the PDF: ${label}`} title={label} className={`${box} inline-flex flex-col items-center justify-center bg-chip text-[11px] font-extrabold leading-tight`} data-report-photo={hook} data-slip-kind="pdf">
        <span aria-hidden>PDF</span>
        <span aria-hidden className="text-[10px] font-semibold text-muted">open</span>
      </a>
    );
  }
  if (kind === "video") {
    return (
      <ViewerThumb src={url} kind="video" label={label} className={`${box} bg-ink`} data-report-photo={hook} data-slip-kind="video">
        <span aria-hidden className="flex h-full w-full items-center justify-center text-lg text-white">▶</span>
      </ViewerThumb>
    );
  }
  return (
    <ViewerThumb src={url} thumb={thumb || url} label={label} className={`${box} bg-chip`} data-report-photo={hook} data-slip-kind="image">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={thumb || url} alt="Payment slip" className="h-full w-full object-cover" />
    </ViewerThumb>
  );
}

/** "Card · auth 123456" / "Bank transfer · ref TT-55": the code never breaks across two lines (a very long one may wrap). */
export function ReportMethodWords({ r }: { r: { method: string; authCode: string | null; reference: string | null } }) {
  const code = r.authCode ? `auth ${r.authCode}` : r.reference ? `ref ${r.reference}` : "";
  return (
    <>
      {methodWord(r.method)}
      {code ? <> · <span className={code.length <= 28 ? "whitespace-nowrap" : "break-words"}>{code}</span></> : null}
    </>
  );
}

function SlipThumb({ r }: { r: PaymentReport }) {
  const p = r.photos[0];
  if (!p?.url) return null;
  return <SlipTile url={p.url} thumb={r.thumbs[p.path] || null} contentType={p.contentType} path={p.path} label={`${r.jobNumber} · ${methodWord(r.method)} slip from ${firstName(r.reporter)}`} hook={r.id} />;
}

/**
 * A job's reports on the job card's money tile and the money page: amber "Payment reported by Anas · waiting for
 * accounts" with the slip (Record it / Query for accounts and the owner), red "Query from Mathew: …" (Send again /
 * Withdraw for the advisor), green "Recorded ✓ RCT-… by Mathew" for a day after.
 */
export function PaymentReportLines({ reports, viewerId, canRecord, canReport, readOnly, balance, expected = null, isOwner = false, reasons }: { reports: PaymentReport[]; viewerId: string; canRecord: boolean; canReport: boolean; readOnly: boolean; balance: number | null; expected?: string | null; isOwner?: boolean; reasons?: readonly string[] }) {
  const [now] = useState(() => Date.now());
  // "Send again" opens its window here, outside the queried line: once the new report is made the queried line leaves
  // the list (live refresh), and the window with "Sent to accounts ✓" must stay on screen.
  const [again, setAgain] = useState<{ r: PaymentReport; n: number } | null>(null);
  const shown = reports.filter((r) => r.status === "waiting" || (r.status === "queried" && !r.replacedBy) || (r.status === "recorded" && r.recordedAt && now - Date.parse(r.recordedAt) < 24 * 3600000));
  if (!shown.length && !again) return null;
  return (
    <>
    {again ? <ReportDialog key={again.n} jobId={again.r.jobId || null} estimateId={again.r.estimateId ?? null} balance={balance} expected={expected} replaces={again.r} onClose={() => setAgain(null)} /> : null}
    <ul className="flex flex-col gap-1.5" data-payment-report-lines>
      {shown.map((r) => {
        const mineToFix = !readOnly && canReport && (r.reporterId === viewerId || isOwner);
        if (r.status === "waiting") {
          return (
            <li key={r.id} className={`flex flex-wrap items-center gap-2 rounded-control border p-2 text-xs ${r.late ? "border-red-bar bg-red-soft" : "border-amber-bar bg-amber-soft"}`} data-payment-reported={r.id} data-report-late={r.late ? "1" : "0"}>
              <SlipThumb r={r} />
              <span className="min-w-[10rem] flex-1">
                <span className="font-bold">Payment reported by {firstName(r.reporter)} · {aed(r.amount)} · <ReportMethodWords r={r} /> · waiting for accounts</span>
                <span className="block text-muted">{timeOf(r.reportedAt)}{r.note ? ` · "${r.note}"` : ""}{r.late ? " · not recorded in time" : ""}</span>
              </span>
              {canRecord ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="md" disabled={readOnly} title={readOnly ? "View as is read-only – use Act as to record" : undefined} onClick={() => openRecordPayment({ jobId: r.jobId, reportId: r.id })} data-report-record={r.id}>Record it</Button>
                  <PaymentReportQuery reportId={r.id} disabled={readOnly} reasons={reasons} />
                </span>
              ) : null}
              {mineToFix ? <WithdrawReport reportId={r.id} /> : null}
            </li>
          );
        }
        if (r.status === "queried") {
          return (
            <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-control border border-red-bar bg-red-soft p-2 text-xs" data-payment-queried={r.id}>
              <SlipThumb r={r} />
              <span className="min-w-[10rem] flex-1">
                <span className="font-bold text-red">Query from {firstName(r.queriedBy)}: {r.queryNote}</span>
                <span className="block text-muted">Your payment of {aed(r.amount)} · {methodWord(r.method)} · sent by {firstName(r.reporter)} {timeOf(r.reportedAt)}</span>
              </span>
              {mineToFix ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="md" tone="secondary" onClick={() => setAgain((cur) => ({ r, n: (cur?.n ?? 0) + 1 }))} data-payment-report-open="again">Send again</Button>
                  <WithdrawReport reportId={r.id} />
                </span>
              ) : null}
            </li>
          );
        }
        return (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-control border border-green bg-green-soft p-2 text-xs" data-payment-report-recorded={r.paymentNumber ?? ""}>
            <span className="font-bold text-green">Recorded ✓ {r.paymentNumber}{r.recordedBy ? ` by ${firstName(r.recordedBy)}` : ""}</span>
            <span className="text-muted">{aed(r.amount)} · {methodWord(r.method)} · sent by {firstName(r.reporter)}</span>
          </li>
        );
      })}
    </ul>
    </>
  );
}

/** The Record and Query buttons on a Waiting on you line, with the slip. */
export function PaymentReportActions({ reportId, jobId, thumb, url, contentType = null, path = null, label, readOnly, actionLabel = "Record", reasons }: { reportId: string; jobId: string; thumb: string | null; url: string | null; contentType?: string | null; path?: string | null; label: string; readOnly: boolean; actionLabel?: string; reasons?: readonly string[] }) {
  return (
    <span className="flex flex-wrap items-center gap-2" data-report-actions={reportId}>
      <SlipTile url={url} thumb={thumb} contentType={contentType} path={path} label={label} hook={reportId} />
      <Button type="button" size="md" disabled={readOnly} title={readOnly ? "View as is read-only – use Act as to record" : undefined} onClick={() => openRecordPayment({ jobId, reportId })} data-report-record={reportId}>{actionLabel}</Button>
      <PaymentReportQuery reportId={reportId} disabled={readOnly} reasons={reasons} />
    </span>
  );
}

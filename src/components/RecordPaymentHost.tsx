"use client";

import { Suspense, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Input, Textarea } from "@/components/ui";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { PaymentForm } from "@/app/(app)/invoices/[id]/PaymentForm";
import { spendFormKey } from "@/components/JobFileUpload";
import { loadPaymentChoices, recordPaymentAnywhere, searchPayers, undoPaymentFromWindow, type ChoicesAnswer, type PayerHit } from "@/app/(app)/invoices/payment-anywhere-actions";
import { UndoButton } from "@/components/UndoButton";
import { reloadIfStale } from "@/lib/app-version";
import { CarThumb } from "@/components/CarThumb";
import { PaymentReportQuery, ReportMethodWords, SlipTile } from "@/components/PaymentReport";
import { firstName } from "@/lib/payment-report-rules";
import { isUuid } from "@/lib/uuid";

/**
 * THE Record payment window (1 November 2026). There must ALWAYS be a way to record a payment for any car or customer
 * at any time: this window opens from every car page, customer page, job card, money page, the Invoices and payments
 * page and the search results, whatever the stage - no job yet, before the check-in approval, in the workshop, after
 * gate-out, old cars. It suggests where the money goes (the job, its proforma or invoice) and otherwise saves it on the
 * customer's account as an unallocated advance with a note. The answer (the receipt, Send the receipt) stays in it.
 */

export type RecordPaymentOpen = { jobId?: string | null; customerId?: string | null; vehicleId?: string | null; /** An advisor's payment report: the window opens pre-filled with what he sent (2 November 2026, section 3). */ reportId?: string | null };

const EVENT = "erp:record-payment";

/** Opens the one window from anywhere (a button, a search result, the customer panel). */
export function openRecordPayment(o: RecordPaymentOpen = {}) {
  window.dispatchEvent(new CustomEvent<RecordPaymentOpen>(EVENT, { detail: o }));
}

/** View as is read-only (2 November 2026): the owner looking as accounts sees the same button, greyed, with the reason. */
export const VIEW_AS_PAY_WORDS = "View as is read-only – use Act as to record";

export function RecordPaymentButton({ label = "Record payment", size = "md", tone = "primary", className, readOnly = false, ...o }: RecordPaymentOpen & { label?: string; size?: "md" | "lg"; tone?: "primary" | "secondary" | "ghost"; className?: string; /** The owner in View as: the button shows, greyed, with the words (the window is not there to open). */ readOnly?: boolean }) {
  if (readOnly) {
    return (
      <span className={`flex flex-col gap-1 ${className ?? ""}`} data-record-payment-readonly>
        <Button type="button" size={size} tone={tone} className="w-full" disabled aria-disabled="true" title={VIEW_AS_PAY_WORDS}>
          {label}
        </Button>
        <span className="text-xs text-muted">{VIEW_AS_PAY_WORDS}</span>
      </span>
    );
  }
  return (
    <Button type="button" size={size} tone={tone} className={className} onClick={() => openRecordPayment(o)} data-record-payment-open>
      {label}
    </Button>
  );
}

/** Mounted once in the app layout for the people who record money; it waits for openRecordPayment. */
export function RecordPaymentHost() {
  const [open, setOpen] = useState<{ o: RecordPaymentOpen; n: number } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setOpen((cur) => ({ o: (e as CustomEvent<RecordPaymentOpen>).detail ?? {}, n: (cur?.n ?? 0) + 1 }));
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  // A bell or a Waiting line for an advisor's payment report opens the page with ?pay-report=<id>: the window opens on
  // it, pre-filled, and the address loses the marker (a reload never opens it twice).
  const reportParam = useSearchParams().get("pay-report");
  const [seenParam, setSeenParam] = useState<string | null>(null);
  if (reportParam && reportParam !== seenParam && isUuid(reportParam)) {
    setSeenParam(reportParam);
    setOpen((cur) => ({ o: { reportId: reportParam }, n: (cur?.n ?? 0) + 1 }));
  } else if (!reportParam && seenParam) setSeenParam(null);
  useEffect(() => {
    if (!reportParam) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("pay-report");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, [reportParam]);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <RecordPaymentDialog key={open.n} start={open.o} onClose={() => setOpen(null)} />
    </Suspense>
  );
}

const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hasWho = (o: RecordPaymentOpen) => !!(o.jobId || o.customerId || o.vehicleId || o.reportId);
const timeOf = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" });

function RecordPaymentDialog({ start, onClose }: { start: RecordPaymentOpen; onClose: () => void }) {
  const router = useRouter();
  const [who, setWho] = useState<RecordPaymentOpen | null>(hasWho(start) ? start : null);
  const [answer, setAnswer] = useState<ChoicesAnswer | null>(null);
  const [loading, setLoading] = useState(hasWho(start));
  const [targetKey, setTargetKey] = useState("");
  const [carId, setCarId] = useState(start.vehicleId ?? "");
  const [note, setNote] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PayerHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [spent, setSpent] = useState<string[]>([]);
  const [seenAt, setSeenAt] = useState(0);
  const [dismissedAt, setDismissedAt] = useState(0);
  const [sending, setSending] = useState(false);
  const [state, formAction] = useActionState(recordPaymentAnywhere, null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const apply = (a: ChoicesAnswer, o: RecordPaymentOpen) => {
    setAnswer(a);
    setTargetKey(a.choices?.suggested ?? "");
    setCarId(o.vehicleId ?? "");
    setLoading(false);
  };
  const load = (o: RecordPaymentOpen) => {
    setWho(o);
    setLoading(true);
    void loadPaymentChoices(o)
      .then((a) => apply(a, o))
      .catch((e) => {
        if (!reloadIfStale(e)) apply({ error: "No connection – try again." }, o);
      });
  };
  // The window opened for a job, car or customer: its choices load at once.
  useEffect(() => {
    if (!hasWho(start)) return;
    let live = true;
    void loadPaymentChoices(start)
      .then((a) => {
        if (live) apply(a, start);
      })
      .catch((e) => {
        if (live && !reloadIfStale(e)) apply({ error: "No connection – try again." }, start);
      });
    return () => {
      live = false;
    };
  }, [start]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The server's answer: a recorded payment spends the form's key (the next payment starts a new one).
  if (state?.at && state.at !== seenAt) {
    setSeenAt(state.at);
    if (state.ok && state.clientKey) setSpent((s) => [...s, state.clientKey as string]);
  }
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  const done = state?.ok && state.at !== dismissedAt ? state : null;
  const [undone, setUndone] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  const search = (text: string) => {
    setQ(text);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setHits(null);
      return;
    }
    timer.current = setTimeout(() => {
      setSearching(true);
      void searchPayers(text)
        .then((r) => {
          setSearching(false);
          setSearchError(r.error ?? null);
          setHits(r.hits ?? []);
        })
        .catch((e) => {
          setSearching(false);
          if (!reloadIfStale(e)) setSearchError("No connection – try again.");
        });
    }, 300);
  };

  const choices = answer?.choices ?? null;
  const target = choices?.targets.find((t) => t.key === targetKey) ?? null;
  // The form is replaced by the "recorded" screen: its key is spent here, so the next payment (same place, same tab,
  // even after a reload) gets a new one instead of "already used" (1 November 2026).
  const spendTag = target ? (target.kind === "unallocated" ? `payment:credit:${choices?.customer.id ?? ""}` : `payment:${target.key}`) : null;
  useEffect(() => {
    if (state?.ok && state.clientKey && spendTag) spendFormKey(spendTag, state.clientKey as string);
  }, [state, spendTag]);
  const another = () => {
    setDismissedAt(state?.at ?? 0);
    setNote("");
    // The report is recorded: another payment opens on the same car, not the report again.
    if (who) load(who.reportId ? (answer?.report?.jobId ? { jobId: answer.report.jobId } : { customerId: answer?.report?.customerId ?? who.customerId ?? null, vehicleId: answer?.report?.vehicleId ?? who.vehicleId ?? null }) : who);
  };
  const report = answer?.report ?? null;
  const reportKeys = answer?.reportTargetKeys ?? [];
  const onReportTarget = !!report && !!target && reportKeys.includes(target.key);
  const [queried, setQueried] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-ink/60 p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Record a payment" data-record-payment-dialog data-report-keys={reportKeys.join(",")}>
      <div className="w-full max-w-2xl rounded-card bg-white p-5 shadow-xl flex flex-col gap-4 max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5 min-w-0">
            <h2 className="text-lg font-extrabold">Record a payment</h2>
            {choices ? (
              <p className="text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-bold uppercase" data-payer-name>{choices.customer.name}</span>
                {choices.customer.phone ? <span className="text-muted">{choices.customer.phone}</span> : null}
                {choices.credit > 0 ? <span className="rounded-control bg-amber-soft px-2 py-0.5 text-xs font-bold" data-payer-credit>Credit {money(choices.credit)} (not allocated)</span> : null}
                {!hasWho(start) ? (
                  <button type="button" className="min-h-11 text-xs font-bold underline underline-offset-4" onClick={() => { setWho(null); setAnswer(null); }} data-payer-change>
                    Change customer
                  </button>
                ) : null}
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 shrink-0 rounded-control border border-line-strong text-lg font-bold" data-record-payment-close>
            ✕
          </button>
        </div>

        {done && undone === done.paymentId ? (
          <div className="flex flex-col gap-3 rounded-control border-2 border-ink bg-white p-4" data-payment-undone={done.number}>
            <p className="text-lg font-extrabold">↩ {done.number} undone</p>
            <p className="text-sm">The receipt is voided (kept, struck through) and nothing went to Zoho Books.</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="md" tone="secondary" onClick={another} data-record-another>Record another payment</Button>
              <Button type="button" size="md" tone="ghost" onClick={onClose} data-record-payment-finish>Done</Button>
            </div>
          </div>
        ) : done ? (
          <div className="flex flex-col gap-3 rounded-control border-2 border-green bg-green-soft p-4" data-record-payment-done={done.number}>
            <p className="text-lg font-extrabold text-green">✓ {done.number} recorded</p>
            <p className="text-sm">{done.where}</p>
            {done.told ? <p className="text-sm font-semibold" data-report-told>{done.told}</p> : null}
            {done.recordedAt && done.paymentId ? (
              <UndoButton
                at={done.recordedAt}
                minutes={done.undoMinutes ?? 10}
                done="Payment recorded"
                busy={undoing}
                onUndo={() => {
                  const id = done.paymentId as string;
                  setUndoing(true);
                  setUndoError(null);
                  void undoPaymentFromWindow(id)
                    .then((r) => {
                      setUndoing(false);
                      if (r.error) setUndoError(r.error);
                      else {
                        setUndone(id);
                        router.refresh();
                      }
                    })
                    .catch((e) => {
                      setUndoing(false);
                      if (!reloadIfStale(e)) setUndoError("No connection – try again.");
                    });
                }}
              />
            ) : null}
            {undoError ? <p className="text-sm font-semibold text-red" data-undo-error>{undoError}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              {done.receiptUrl ? <a href={done.receiptUrl} target="_blank" rel="noreferrer" className="min-h-11 inline-flex items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-receipt-link>Receipt (PDF)</a> : null}
              {done.receiptMessage ? <Button type="button" size="md" onClick={() => setSending(true)} data-send-receipt>Send the receipt</Button> : null}
              <Button type="button" size="md" tone="secondary" onClick={another} data-record-another>Record another payment</Button>
              <Button type="button" size="md" tone="ghost" onClick={onClose} data-record-payment-finish>Done</Button>
            </div>
          </div>
        ) : !who ? (
          <div className="flex flex-col gap-2" data-payer-search>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">Who is paying? Customer name, mobile, plate, VIN or job number</span>
              <Input value={q} onChange={(e) => search(e.target.value)} autoFocus spellCheck={false} placeholder="e.g. J-00969, 0529562232, W 64762" data-payer-search-input />
            </label>
            {searching ? <p className="text-xs text-muted">Searching…</p> : null}
            {searchError ? <p className="text-sm font-semibold text-red">{searchError}</p> : null}
            {hits && !hits.length && !searching ? <p className="text-sm text-muted">No customer, car or job found.</p> : null}
            {hits?.length ? (
              <ul className="flex flex-col divide-y divide-line rounded-control border border-line" data-payer-hits>
                {hits.map((h) => (
                  <li key={h.key} className="flex items-stretch">
                    {/* One row per customer, car and job: the car picture, plate, make and model, the customer, the job and what is left. */}
                    <button type="button" className="min-w-0 flex-1 min-h-14 px-3 py-2 text-left hover:bg-canvas flex items-center gap-3" onClick={() => load({ customerId: h.customerId, vehicleId: h.vehicleId, jobId: h.jobId })} data-payer-hit={h.customerId} data-payer-job={h.jobNumber ?? ""}>
                      <CarThumb url={h.pictureUrl} alt={h.plate || h.name} size="sm" />
                      <span className="min-w-0 flex-1 flex flex-col">
                        <span className="text-sm font-bold uppercase" data-payer-car>{h.plate ? [h.plate, h.car].filter(Boolean).join(" · ") : "No car on record"}</span>
                        <span className="text-xs text-muted" data-payer-who><span className="uppercase">{h.name}</span>{h.jobNumber ? <> · <span className="whitespace-nowrap">{h.jobNumber}</span></> : null}{h.phone ? ` · ${h.phone}` : ""}</span>
                      </span>
                      <span className={`shrink-0 max-w-[9rem] text-right text-xs font-bold ${h.balance !== null && h.balance > 0.005 ? "text-ink" : h.jobId ? "text-green" : "text-muted"}`} data-payer-balance>{h.moneyWords}</span>
                    </button>
                    {h.jobId ? <Link href={`/jobs/${h.jobId}`} onClick={onClose} className="shrink-0 min-h-11 px-3 flex items-center text-xs font-bold underline underline-offset-4" data-payer-job-card>Job card</Link> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : loading || !answer ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : answer.error || !choices ? (
          <p className="text-sm font-semibold text-red" data-record-payment-error>{answer.error ?? "Not found."}</p>
        ) : report && (report.closed || queried) ? (
          <div className="flex flex-col gap-3 rounded-control border-2 border-line-strong p-4" data-report-closed>
            <p className="text-sm font-semibold">{queried ? `Queried – ${firstName(report.reporter)} is told.` : report.closed}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="md" tone="secondary" onClick={() => { setQueried(false); load(report.jobId ? { jobId: report.jobId } : { customerId: report.customerId, vehicleId: report.vehicleId }); }} data-record-without-report>Record a payment on this car</Button>
              <Button type="button" size="md" tone="ghost" onClick={onClose}>Close</Button>
            </div>
          </div>
        ) : (
          <>
            {report ? (
              <div className="flex flex-wrap items-center gap-3 rounded-control border-2 border-amber-bar bg-amber-soft p-3" data-report-banner={report.id}>
                <SlipTile url={report.photos[0]?.url ?? null} thumb={report.photos[0] ? report.thumbs[report.photos[0].path] || null : null} contentType={report.photos[0]?.contentType ?? null} path={report.photos[0]?.path ?? null} label={`${report.methodWords} slip from ${firstName(report.reporter)}`} hook={report.id} size="h-16 w-16" />
                <span className="min-w-[12rem] flex-1 text-sm">
                  <span className="block font-bold">Reported by {firstName(report.reporter)} · {timeOf(report.reportedAt)} · {money(report.amount)} · <ReportMethodWords r={report} /></span>
                  {report.note ? <span className="block text-xs">&quot;{report.note}&quot;</span> : null}
                  <span className="block text-xs text-muted">Check the slip against the bank, then Record (you are asked once more), or Query it back. Wrong car? Query it back.</span>
                </span>
                <PaymentReportQuery reportId={report.id} reasons={answer?.queryReasons} onDone={() => setQueried(true)} />
                {/* The always-rule: a payment that is NOT this report is still recorded here, without the report. */}
                <button type="button" className="min-h-11 basis-full text-left text-xs font-bold underline underline-offset-4" onClick={() => load(report.jobId ? { jobId: report.jobId } : { customerId: report.customerId, vehicleId: report.vehicleId })} data-record-other-payment>
                  Record a different payment instead (this report keeps waiting)
                </button>
              </div>
            ) : null}
            <div className="flex flex-col gap-2" data-pay-targets>
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Where does it go?</span>
              {choices.targets.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTargetKey(t.key)}
                  aria-pressed={targetKey === t.key}
                  data-pay-target={t.key}
                  data-pay-target-kind={t.kind}
                  className={`min-h-12 rounded-control border-2 px-3 py-2 text-left flex flex-col ${targetKey === t.key ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}
                >
                  <span className="text-sm font-bold uppercase">{t.kind === "unallocated" ? t.title : `Allocate to ${t.title}`}</span>
                  <span className={`text-xs ${targetKey === t.key ? "text-white/80" : "text-muted"}`}>{t.detail}</span>
                </button>
              ))}
              {!choices.unallocatedReady ? <p className="text-xs text-muted">Saving a payment on the customer&apos;s account (not allocated) switches on with the database update of 1 November.</p> : null}
            </div>
            {target ? (
              <PaymentForm
                key={`${target.key}:${dismissedAt}:${report?.id ?? ""}`}
                prefill={onReportTarget && report ? { amount: report.amount, method: report.method, authCode: report.authCode, reference: report.reference } : null}
                fixedKey={onReportTarget && report ? report.id : null}
                initialProofs={onReportTarget && report ? report.photos : null}
                tag={target.kind === "unallocated" ? `payment:credit:${choices.customer.id}` : `payment:${target.key}`}
                invoiceId={target.kind === "invoice" ? target.invoiceId : null}
                jobId={target.kind === "job" ? target.jobId : null}
                proofJobId={target.jobId}
                spentKeys={spent}
                balance={target.balance}
                balanceLabel={target.kind === "invoice" ? "the balance" : "what is left of the approved total"}
                action={formAction}
                charges={answer.charges!}
                methods={answer.methods ?? []}
                isOwner={!!answer.isOwner}
                invoiceNumber={target.invoiceNumber ?? ""}
                isProforma={target.isProforma}
                nextTaxNumber={choices.nextTaxNumber}
                hidden={target.kind === "unallocated" ? { unallocated: "1", customer_id: choices.customer.id, vehicle_id: carId } : null}
                extra={
                  target.kind === "unallocated" ? (
                    <div className="flex flex-col gap-2">
                      {choices.cars.length ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-muted">For which car? (optional)</span>
                          <div className="flex flex-wrap gap-2">
                            {[{ id: "", plate: "No particular car", car: "" }, ...choices.cars].map((c) => (
                              <button key={c.id || "none"} type="button" onClick={() => setCarId(c.id)} aria-pressed={carId === c.id} data-pay-car={c.id || "none"} className={`min-h-11 rounded-control border-2 px-3 text-xs font-bold ${carId === c.id ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
                                {[c.plate, c.car].filter(Boolean).join(" · ")}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                      <label className="flex flex-col gap-1">
                        <span className="text-xs font-semibold text-muted">What is it for? (required)</span>
                        <Textarea name="notes" value={note} onChange={(e) => setNote(e.target.value)} rows={2} required minLength={3} placeholder="e.g. advance for the PPF booked next week" data-pay-for />
                      </label>
                    </div>
                  ) : null
                }
              />
            ) : (
              <p className="text-sm text-muted">Choose where the payment goes.</p>
            )}
            {state?.error && state.at !== dismissedAt ? <p className="text-sm font-semibold text-red" data-record-payment-error>{state.error}</p> : null}
          </>
        )}
      </div>
      {sending && done?.receiptMessage ? (
        <SendLinkDialog
          title={`Send the receipt ${done.number}`}
          message={done.receiptMessage}
          phoneDigits={done.phoneDigits ?? ""}
          pdf={done.receiptUrl ? { href: done.receiptUrl, fileName: `OFJ Receipt ${done.number}.pdf` } : null}
          onClose={() => setSending(false)}
          onSent={() => setSending(false)}
        />
      ) : null}
    </div>
  );
}

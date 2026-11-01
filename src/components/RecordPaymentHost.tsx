"use client";

import { Suspense, useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Textarea } from "@/components/ui";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { PaymentForm } from "@/app/(app)/invoices/[id]/PaymentForm";
import { loadPaymentChoices, recordPaymentAnywhere, searchPayers, type ChoicesAnswer, type PayerHit } from "@/app/(app)/invoices/payment-anywhere-actions";
import { reloadIfStale } from "@/lib/app-version";

/**
 * THE Record payment window (1 November 2026). There must ALWAYS be a way to record a payment for any car or customer
 * at any time: this window opens from every car page, customer page, job card, money page, the Invoices and payments
 * page and the search results, whatever the stage - no job yet, before the check-in approval, in the workshop, after
 * gate-out, old cars. It suggests where the money goes (the job, its proforma or invoice) and otherwise saves it on the
 * customer's account as an unallocated advance with a note. The answer (the receipt, Send the receipt) stays in it.
 */

export type RecordPaymentOpen = { jobId?: string | null; customerId?: string | null; vehicleId?: string | null };

const EVENT = "erp:record-payment";

/** Opens the one window from anywhere (a button, a search result, the customer panel). */
export function openRecordPayment(o: RecordPaymentOpen = {}) {
  window.dispatchEvent(new CustomEvent<RecordPaymentOpen>(EVENT, { detail: o }));
}

export function RecordPaymentButton({ label = "Record payment", size = "md", tone = "primary", className, ...o }: RecordPaymentOpen & { label?: string; size?: "md" | "lg"; tone?: "primary" | "secondary" | "ghost"; className?: string }) {
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
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <RecordPaymentDialog key={open.n} start={open.o} onClose={() => setOpen(null)} />
    </Suspense>
  );
}

const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const hasWho = (o: RecordPaymentOpen) => !!(o.jobId || o.customerId || o.vehicleId);

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
  const another = () => {
    setDismissedAt(state?.at ?? 0);
    setNote("");
    if (who) load(who);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-ink/60 p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="Record a payment" data-record-payment-dialog>
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

        {done ? (
          <div className="flex flex-col gap-3 rounded-control border-2 border-green bg-green-soft p-4" data-record-payment-done={done.number}>
            <p className="text-lg font-extrabold text-green">✓ {done.number} recorded</p>
            <p className="text-sm">{done.where}</p>
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
              <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
                {hits.map((h) => (
                  <li key={`${h.customerId}:${h.vehicleId ?? ""}:${h.jobId ?? ""}`}>
                    <button type="button" className="w-full min-h-12 px-3 py-2 text-left hover:bg-canvas flex flex-col" onClick={() => load({ customerId: h.customerId, vehicleId: h.vehicleId, jobId: h.jobId })} data-payer-hit={h.customerId}>
                      <span className="text-sm font-bold uppercase">{h.name}{h.jobNumber ? ` · ${h.jobNumber}` : ""}</span>
                      <span className="text-xs text-muted">{[h.car, h.phone].filter(Boolean).join(" · ") || "No car on record"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : loading || !answer ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : answer.error || !choices ? (
          <p className="text-sm font-semibold text-red" data-record-payment-error>{answer.error ?? "Not found."}</p>
        ) : (
          <>
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
                key={`${target.key}:${dismissedAt}`}
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
          checkSpelling={false}
          pdf={done.receiptUrl ? { href: done.receiptUrl, fileName: `OFJ Receipt ${done.number}.pdf` } : null}
          onClose={() => setSending(false)}
          onSent={() => setSending(false)}
        />
      ) : null}
    </div>
  );
}

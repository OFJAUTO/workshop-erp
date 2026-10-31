"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Input } from "@/components/ui";
import { PAYMENT_METHOD_LABELS, confirmFullText } from "@/lib/money-steps";
import { JobFileUpload, markFormSent, useFormKey, useRenewAfterAnswer, type FilesWaiting, type JobFile } from "@/components/JobFileUpload";
import { feeRuleWords, feesFor, type BankFees } from "@/lib/bank-fees";
import { AuthCodeInput } from "@/components/AuthCodeInput";
import { needsAuthCode } from "@/lib/auth-code";

const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function RecordButton({ label, disabled = false }: { label: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return <Button type="submit" size="lg" disabled={pending || disabled} data-record-payment>{pending ? "Recording…" : label}</Button>;
}

/**
 * Recording a payment in three taps: the method (only the ones this person may record; the expected one is
 * pre-selected), Full amount or Partial, Record. A full payment asks once more, in plain words, what it does:
 * the proforma becomes a tax invoice that can never be deleted. A cheque asks for its number and date. The same
 * tap twice makes one receipt, not two; more than the balance goes to the owner for approval.
 */
export function PaymentForm({
  invoiceId,
  jobId,
  proofJobId = null,
  balance,
  action,
  charges,
  methods,
  expected = null,
  returnTo = null,
  isOwner = false,
  invoiceNumber = "",
  isProforma = false,
  nextTaxNumber = null,
  spentKeys,
}: {
  invoiceId: string | null;
  jobId: string | null;
  /** The job the invoice belongs to: the proof photo goes through the send queue under it. */
  proofJobId?: string | null;
  /** The client keys of payments already recorded on this job: a form still holding one of them starts a new key. */
  spentKeys?: string[];
  balance: number | null;
  action: (formData: FormData) => void;
  /** Bank charge per method, in percent. */
  /** The bank's fee rule per method (bank-fees.ts). */
  charges: BankFees;
  /** The methods this person may record. */
  methods: string[];
  expected?: string | null;
  returnTo?: string | null;
  isOwner?: boolean;
  invoiceNumber?: string;
  isProforma?: boolean;
  /** The number the tax invoice will get when this payment settles the proforma. */
  nextTaxNumber?: string | null;
}) {
  const first = expected && methods.includes(expected) ? expected : methods[0] ?? "";
  const [method, setMethod] = useState(first);
  const [mode, setMode] = useState<"full" | "partial">(balance && balance > 0 ? "full" : "partial");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // The form's own key ties the proof to the payment. It stays the same across a reload or a new version (a proof still
  // waiting on the device stays with this form) and is renewed once a payment with it is recorded.
  const formTag = invoiceId ? `payment:${invoiceId}` : `payment:job:${jobId ?? proofJobId ?? "none"}`;
  const { key: clientKey, renew } = useFormKey(formTag, proofJobId);
  // The page came back with "message" after this form was submitted: that payment is recorded, the key is spent (a reused
  // key would be taken for the same payment, "already recorded"). The page's own list of recorded keys says the same.
  useRenewAfterAnswer(formTag, clientKey, renew);
  useEffect(() => {
    if (clientKey && spentKeys?.includes(clientKey)) renew(clientKey);
  }, [spentKeys, clientKey, renew]);
  // The proofs the server has for THIS key (a new key starts with none).
  const [proofState, setProofState] = useState<{ key: string | null; files: JobFile[] }>({ key: null, files: [] });
  if (proofState.key !== clientKey) setProofState({ key: clientKey, files: [] });
  const proofs = proofState.key === clientKey ? proofState.files : [];
  const [proofWait, setProofWait] = useState<FilesWaiting>({ count: 0, stopped: 0 });
  const rule = charges[method];
  const value = mode === "full" && balance ? balance : Number(amount) || 0;
  const over = balance !== null && value > balance + 0.005;
  const settles = balance !== null && balance > 0 && value >= balance - 0.005 && !over;
  // A card or transfer payment is recorded only once the server has its proof - never on a file still on the device.
  const needsProof = method === "card" || method === "transfer";
  const proofBlocked = needsProof && !!proofJobId && proofs.length === 0;
  const proofLine = !proofBlocked ? null : proofWait.stopped ? "The proof could not be sent – try again or remove it, then attach it again." : proofWait.count ? "The proof is still sending – Record works once it has arrived." : "Attach the proof first.";
  const blocked = !clientKey || proofBlocked;
  if (!methods.length) return <p className="text-sm text-muted">Payments are recorded by accounts (bank side) or the advisor at the counter.</p>;

  return (
    <>
      <form ref={formRef} action={action} onSubmit={() => markFormSent(formTag, clientKey)} className="flex flex-col gap-3" data-payment-form>
        {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
        {invoiceId ? <input type="hidden" name="invoice_id" value={invoiceId} /> : null}
        {jobId ? <input type="hidden" name="job_id" value={jobId} /> : null}
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="client_key" value={clientKey ?? ""} />
        <input type="hidden" name="amount" value={mode === "full" && balance ? balance.toFixed(2) : amount} />
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {methods.map((m) => (
            <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m} data-method={m} className={`min-h-12 rounded-control border-2 text-sm font-bold ${method === m ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
              {PAYMENT_METHOD_LABELS[m] ?? m}
              {expected === m ? <span className={`block text-[10px] font-semibold ${method === m ? "text-white/80" : "text-muted"}`}>expected</span> : null}
            </button>
          ))}
        </div>
        {balance && balance > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode("full")} aria-pressed={mode === "full"} data-amount-full className={`min-h-12 rounded-control border-2 text-sm font-bold ${mode === "full" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
              Full amount · {money(balance)}
            </button>
            <button type="button" onClick={() => setMode("partial")} aria-pressed={mode === "partial"} data-amount-partial className={`min-h-12 rounded-control border-2 text-sm font-bold ${mode === "partial" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
              Part payment
            </button>
          </div>
        ) : null}
        {mode === "partial" || !balance ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Amount received (AED)</span>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required className="max-w-56" data-amount-input />
          </label>
        ) : null}
        {method === "cheque" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cheque number</span><Input name="cheque_number" inputMode="numeric" required /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cheque date</span><Input name="cheque_date" type="date" required /></label>
          </div>
        ) : null}
        {needsAuthCode(method) ? (
          <AuthCodeInput method={method} value={authCode} onChange={setAuthCode} />
        ) : method === "transfer" ? (
          <Input name="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer reference (optional)" className="max-w-72" data-reference />
        ) : null}
        {needsProof ? (
          proofJobId ? (
            // A plain box, not a label: a tap on the words must never press the first button inside (a thumbnail, Try again).
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">{method === "card" ? "Photo of the card slip (required)" : "Transfer proof: screenshot or photo (required)"}</span>
              {clientKey ? (
                <JobFileUpload
                  jobId={proofJobId}
                  kind="payment_proof"
                  refId={clientKey}
                  form={{ tag: formTag, key: clientKey }}
                  files={proofs}
                  accept="any"
                  label="Take photo / attach"
                  compact
                  removable
                  onAdded={(f) => setProofState((s) => (f.refId === s.key && !s.files.some((x) => x.id === f.id) ? { ...s, files: [...s.files, f] } : s))}
                  onRemoved={(f) => setProofState((s) => ({ ...s, files: s.files.filter((x) => x.id !== f.id) }))}
                  onPending={setProofWait}
                />
              ) : null}
              {proofLine ? <span className="text-xs font-semibold text-amber-bar" data-proof-missing {...(proofWait.count && !proofWait.stopped ? { "data-proof-sending": "" } : {})}>{proofLine}</span> : null}
            </div>
          ) : (
            // An invoice without a job (none today): the proof still goes with the form through the server.
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">{method === "card" ? "Photo of the card slip (required)" : "Transfer proof: screenshot or photo (required)"}</span>
              <input type="file" name="proof" accept="image/*,.pdf" required className="min-h-11 w-full max-w-72 rounded-control border border-line-strong bg-white px-3 py-2 text-sm file:mr-3 file:rounded-control file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white" data-proof-input />
            </label>
          )
        ) : null}
        <p className="text-xs text-muted">
          {feeRuleWords(rule) !== "no bank fee" ? `Bank fee ${feeRuleWords(rule)} on ${(PAYMENT_METHOD_LABELS[method] ?? method).toLowerCase()}${value > 0 ? ` (estimated ${money(feesFor(value, rule).cost)}${feesFor(value, rule).vat > 0 ? ` + VAT ${money(feesFor(value, rule).vat)}` : ""})` : ""}, internal, never shown to the customer.` : "No bank fee on this method."}
          {method === "cheque" ? " A cheque counts as unpaid until it is marked cleared." : ""}
        </p>
        {over ? <p className="text-sm font-semibold text-amber">{isOwner ? "More than the balance: recorded as the owner." : "More than the balance: the owner is asked to approve it before it counts."}</p> : null}
        {/* A full payment is confirmed in words first: it creates the tax invoice, which can never be undone. */}
        <div>{settles && invoiceId ? <Button type="button" size="lg" disabled={blocked} onClick={() => setConfirming(true)} data-record-payment>Record full payment</Button> : <RecordButton label={over && !isOwner ? "Request owner approval" : "Record"} disabled={blocked} />}</div>
      </form>

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label="Confirm full payment" data-confirm-full>
          <div className="w-full max-w-lg rounded-card bg-white p-5 flex flex-col gap-4 shadow-xl">
            <h2 className="text-lg font-extrabold">Confirm full payment</h2>
            <p className="text-sm leading-relaxed">{confirmFullText({ amount: value, method, reference: needsAuthCode(method) ? (authCode ? `auth ${authCode}` : null) : reference || null, invoiceNumber, isProforma, nextTaxNumber })}</p>
            <Button
              type="button"
              size="lg"
              className="w-full"
              data-confirm-yes
              onClick={() => {
                setConfirming(false);
                formRef.current?.requestSubmit();
              }}
            >
              {isProforma ? "Yes, record and create tax invoice" : "Yes, record the payment"}
            </Button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-11 w-full rounded-control border border-line-strong bg-white text-sm font-bold" data-confirm-back>Go back</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

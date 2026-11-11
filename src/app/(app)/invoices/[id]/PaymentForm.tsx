"use client";

import { proofLabel, proofRequired } from "@/lib/payment-proof";
import { ProofFileInput } from "@/components/ProofFileInput";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Input } from "@/components/ui";
import { PAYMENT_METHOD_LABELS, confirmFullText } from "@/lib/money-steps";
import { JobFileUpload, markFormSent, useFormKey, useRenewAfterAnswer, type FilesWaiting, type JobFile } from "@/components/JobFileUpload";
import { feeRuleWords, feesFor, type BankFees } from "@/lib/bank-fees";
import { AuthCodeInput } from "@/components/AuthCodeInput";
import { authConfirmWords, needsAuthCode, realAuthCode } from "@/lib/auth-code";

const money = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
  tag = null,
  hidden = null,
  extra = null,
  balanceLabel = "the balance",
  prefill = null,
  fixedKey = null,
  initialProofs = null,
  pendingBank = null,
}: {
  /** 9 November 2026: a cheque or transfer already waiting for the bank covers the balance ("A cheque for AED 2,131.50 is already pending (RCT-00058). Record another anyway?"): a reason is needed. */
  pendingBank?: string | null;
  /** Opened from an advisor's payment report (2 November 2026): what he sent fills the form; accounts check and confirm. */
  prefill?: { amount: number; method: string; authCode: string | null; reference: string | null } | null;
  /** The receipt's key is fixed (the report's id): one report makes one receipt, never two. */
  fixedKey?: string | null;
  /** Proofs already on the server for the fixed key (the advisor's slip). */
  initialProofs?: JobFile[] | null;
  /** The form's own key name (one per place a payment can go); by default the invoice or the job. */
  tag?: string | null;
  /** Extra hidden fields sent with the payment (the Record payment window: the customer's account, the car). */
  hidden?: Record<string, string> | null;
  /** Boxes shown inside the form above the methods (the window: "What is it for?"). */
  extra?: ReactNode;
  /** How "what is left" is called in the over-the-balance words. */
  balanceLabel?: string;
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
  const first = prefill && methods.includes(prefill.method) ? prefill.method : expected && methods.includes(expected) ? expected : methods[0] ?? "";
  const [method, setMethod] = useState(first);
  const prefillFull = !!prefill && !!balance && Math.abs(prefill.amount - balance) < 0.005;
  const [mode, setMode] = useState<"full" | "partial">(prefill ? (prefillFull ? "full" : "partial") : balance && balance > 0 ? "full" : "partial");
  const [amount, setAmount] = useState(prefill && !prefillFull ? prefill.amount.toFixed(2) : "");
  const [reference, setReference] = useState(prefill?.reference ?? "");
  // A made-up code the advisor typed is never carried into accounts' box (3 November 2026): it counts as no code.
  const [authCode, setAuthCode] = useState(realAuthCode(prefill?.authCode) ?? "");
  const [confirming, setConfirming] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // The form's own key ties the proof to the payment. It stays the same across a reload or a new version (a proof still
  // waiting on the device stays with this form) and is renewed once a payment with it is recorded.
  const formTag = tag ?? (invoiceId ? `payment:${invoiceId}` : `payment:job:${jobId ?? proofJobId ?? "none"}`);
  const formKey = useFormKey(formTag, proofJobId);
  const clientKey = fixedKey ?? formKey.key;
  const renew = formKey.renew;
  // The page came back with "message" after this form was submitted: that payment is recorded, the key is spent (a reused
  // key would be taken for the same payment, "already recorded"). The page's own list of recorded keys says the same.
  useRenewAfterAnswer(formTag, clientKey, renew);
  useEffect(() => {
    if (clientKey && spentKeys?.includes(clientKey)) renew(clientKey);
  }, [spentKeys, clientKey, renew]);
  // The proofs the server has for THIS key (a new key starts with none).
  const [proofState, setProofState] = useState<{ key: string | null; files: JobFile[] }>({ key: null, files: [] });
  if (proofState.key !== clientKey) setProofState({ key: clientKey, files: clientKey && clientKey === fixedKey ? (initialProofs ?? []) : [] });
  const proofs = proofState.key === clientKey ? proofState.files : [];
  const [proofWait, setProofWait] = useState<FilesWaiting>({ count: 0, stopped: 0 });
  const rule = charges[method];
  const value = mode === "full" && balance ? balance : Number(amount) || 0;
  const over = balance !== null && value > balance + 0.005;
  const settles = balance !== null && balance > 0 && value >= balance - 0.005 && !over;
  // A card or transfer payment is recorded only once the server has its proof - never on a file still on the device.
  // Proof on every payment method (10 November 2026, Section 6): required for card, transfer and cheque.
  const needsProof = proofRequired(method);
  const proofBlocked = needsProof && !!proofJobId && proofs.length === 0;
  const proofLine = !proofBlocked ? null : proofWait.stopped ? "The proof could not be sent – try again or remove it, then attach it again." : proofWait.count ? "The proof is still sending – Record works once it has arrived." : "Attach the proof first.";
  const blocked = !clientKey || proofBlocked;
  if (!methods.length) return <p className="text-sm text-muted">Payments are recorded by accounts (bank side) or the advisor at the counter.</p>;

  // A box still missing (the note on an over-payment, a cheque number) is pointed at before the question opens.
  const openConfirm = () => {
    if (formRef.current && !formRef.current.reportValidity()) return;
    setConfirming(true);
  };
  return (
    <>
      <form ref={formRef} action={action} onSubmit={() => markFormSent(formTag, clientKey)} className="flex flex-col gap-3" data-payment-form>
        {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
        {invoiceId ? <input type="hidden" name="invoice_id" value={invoiceId} /> : null}
        {jobId ? <input type="hidden" name="job_id" value={jobId} /> : null}
        {fixedKey ? <input type="hidden" name="report_id" value={fixedKey} /> : null}
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="client_key" value={clientKey ?? ""} />
        <input type="hidden" name="amount" value={mode === "full" && balance ? balance.toFixed(2) : amount} />
        {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
        {extra}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {methods.map((m) => (
            <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m} data-method={m} className={`min-h-12 rounded-control border-2 text-sm font-bold ${method === m ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>
              {PAYMENT_METHOD_LABELS[m] ?? m}
              {expected === m ? <span className={`block text-xs font-semibold ${method === m ? "text-on-dark/80" : "text-muted"}`}>expected</span> : null}
            </button>
          ))}
        </div>
        {balance && balance > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode("full")} aria-pressed={mode === "full"} data-amount-full className={`min-h-12 rounded-control border-2 text-sm font-bold ${mode === "full" ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>
              Full amount · {money(balance)}
            </button>
            <button type="button" onClick={() => setMode("partial")} aria-pressed={mode === "partial"} data-amount-partial className={`min-h-12 rounded-control border-2 text-sm font-bold ${mode === "partial" ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cheque number</span><Input name="cheque_number" inputMode="numeric" required data-cheque-number /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Bank</span><Input name="cheque_bank" placeholder="e.g. Emirates NBD" data-cheque-bank /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cheque date</span><Input name="cheque_date" type="date" required data-cheque-date /></label>
          </div>
        ) : null}
        {needsAuthCode(method) ? (
          <AuthCodeInput method={method} value={authCode} onChange={setAuthCode} />
        ) : method === "transfer" ? (
          <Input name="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Transfer reference (optional)" className="max-w-72" data-reference />
        ) : null}
        {method ? (
          proofJobId ? (
            // A plain box, not a label: a tap on the words must never press the first button inside (a thumbnail, Try again).
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted" data-proof-label={needsProof ? "required" : "optional"}>{proofLabel(method)}</span>
              {clientKey ? (
                <JobFileUpload
                  jobId={proofJobId}
                  kind="payment_proof"
                  refId={clientKey}
                  form={{ tag: formTag, key: clientKey }}
                  files={proofs}
                  accept="any"
                  label="Add proof"
                  compact
                  removable={!fixedKey}
                  alsoKinds={fixedKey ? ["payment_report"] : undefined}
                  onAdded={(f) => setProofState((s) => (f.refId === s.key && !s.files.some((x) => x.id === f.id) ? { ...s, files: [...s.files, f] } : s))}
                  onRemoved={(f) => setProofState((s) => ({ ...s, files: s.files.filter((x) => x.id !== f.id) }))}
                  onPending={setProofWait}
                />
              ) : null}
              {proofLine ? <span className="text-xs font-semibold text-amber-bar" data-proof-missing {...(proofWait.count && !proofWait.stopped ? { "data-proof-sending": "" } : {})}>{proofLine}</span> : null}
            </div>
          ) : (
            // An invoice without a job (an estimate's proforma, a pending charge): the proof goes with the form through
            // the server — unless the advisor's report already carries the slip (4 November 2026), which IS the proof.
            <div className="flex flex-col gap-1" {...(proofs.length ? { "data-proof-from-report": "1" } : {})}>
              <ProofFileInput label={proofs.length ? "Proof: the advisor's slip is attached ✓ (add a clearer one if needed)" : proofLabel(method)} required={needsProof && proofs.length === 0} />
            </div>
          )
        ) : null}
        <p className="text-xs text-muted">
          {feeRuleWords(rule) !== "no bank fee" ? `Bank fee ${feeRuleWords(rule)} on ${(PAYMENT_METHOD_LABELS[method] ?? method).toLowerCase()}${value > 0 ? ` (estimated ${money(feesFor(value, rule).cost)}${feesFor(value, rule).vat > 0 ? ` + VAT ${money(feesFor(value, rule).vat)}` : ""})` : ""}, internal, never shown to the customer.` : "No bank fee on this method."}
          {method === "cheque" ? " A cheque counts as unpaid until it is marked cleared." : method === "transfer" ? " A transfer counts once accounts confirm it reached the bank." : ""}
        </p>
        {pendingBank ? (
          <label className="flex flex-col gap-1 rounded-control border-2 border-amber-bar bg-amber-soft p-3" data-duplicate-warning>
            <span className="text-sm font-bold">{pendingBank}</span>
            <span className="text-xs text-muted">Only if the customer really paid again. Write why – it is kept with the payment.</span>
            <Input name="duplicate_reason" required minLength={3} placeholder="e.g. the cheque is for another car; a second payment for the extra work" data-duplicate-reason />
          </label>
        ) : null}
        {over ? (
          // 1 November 2026: more than what is left is allowed with a note of why; it is logged and the owner is told.
          <label className="flex flex-col gap-1 rounded-control border-2 border-amber-bar bg-amber-soft p-3" data-over-warning>
            <span className="text-sm font-bold">More than {balanceLabel} ({money(balance ?? 0)}) by {money(value - (balance ?? 0))}.</span>
            <span className="text-xs text-muted">Write why – a refund to make or credit to keep. It is logged{isOwner ? "" : " and the owner is told"}.</span>
            <Input name="over_note" required minLength={3} placeholder="e.g. customer paid extra, refund AED 500 by transfer" data-over-note />
          </label>
        ) : null}
        {/* Every payment is confirmed in words first (B3, 1 November 2026); a full payment also says it makes the tax invoice. */}
        <div>{settles && invoiceId ? <Button type="button" size="lg" disabled={blocked} onClick={openConfirm} data-record-payment>Record full payment</Button> : <Button type="button" size="lg" disabled={blocked || !(value > 0)} onClick={openConfirm} data-record-payment>Record</Button>}</div>
      </form>

      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label={settles && invoiceId ? "Confirm full payment" : "Confirm the payment"} data-confirm-full>
          <div className="w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-card bg-white p-5 flex flex-col gap-4 shadow-xl">
            <h2 className="text-lg font-extrabold">{settles && invoiceId ? "Confirm full payment" : "Confirm the payment"}</h2>
            <p className="text-sm leading-relaxed" data-confirm-text>{settles && invoiceId ? confirmFullText({ amount: value, method, reference: needsAuthCode(method) ? (realAuthCode(authCode) ? `auth ${realAuthCode(authCode)}` : null) : reference || null, authMissing: needsAuthCode(method) && !realAuthCode(authCode), invoiceNumber, isProforma, nextTaxNumber }) : [`Record payment of ${money(value)}`, invoiceNumber ? `against ${invoiceNumber}` : jobId ? "as an advance on the job" : "on the customer's account", PAYMENT_METHOD_LABELS[method] ?? method, authConfirmWords(method, authCode) ?? (reference ? `ref ${reference}` : ""), needsProof || proofs.length ? (proofs.length ? "proof attached ✓" : "proof to attach") : ""].filter(Boolean).join(" · ")}</p>
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
              {settles && invoiceId && isProforma ? "Yes, record and create tax invoice" : "Yes, record payment"}
            </Button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-11 w-full rounded-control border border-line-strong bg-white text-sm font-bold" data-confirm-back>Go back</button>
          </div>
        </div>
      ) : null}
    </>
  );
}

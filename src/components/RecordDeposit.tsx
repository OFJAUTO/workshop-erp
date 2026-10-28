"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { recordDepositPanel, type RecordDepositResult } from "@/app/(app)/dashboard/record-deposit-actions";
import { JobFileUpload, type JobFile } from "./JobFileUpload";
import { SendLinkDialog } from "./SendLinkDialog";
import { Button, Input } from "./ui";
import { newUuid } from "@/lib/uuid";
import { reloadIfStale } from "@/lib/app-version";
import { feeRuleWords, feesFor, type BankFees } from "@/lib/bank-fees";
import { AuthCodeInput } from "@/components/AuthCodeInput";
import { needsAuthCode } from "@/lib/auth-code";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const METHODS = [
  ["cash", "Cash"],
  ["card", "Card"],
  ["link", "Payment link"],
  ["transfer", "Bank transfer"],
  ["cheque", "Cheque"],
] as const;

export type RecordDepositData = {
  jobId: string;
  plate: string;
  car: string | null;
  customer: string | null;
  quote: string;
  requested: number;
  received: number;
  outstanding: number;
};

function todayDubai() {
  return new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
}

/**
 * "Record the deposit" on Waiting on you (1.1, 21 October 2026): the whole action in a centre panel,
 * no page change. Amount pre-filled with what was asked, the five methods as chips, reference and date,
 * several proof files (required for card and transfer), one clear confirmation, and after saving the
 * receipt number with Send receipt right there. More than asked is kept as an advance on the job and
 * said in plain words.
 */
export function RecordDeposit({ d, charges, label = "Record the deposit" }: { d: RecordDepositData; charges: BankFees; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState(d.outstanding > 0 ? String(d.outstanding) : "");
  const [reference, setReference] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [date, setDate] = useState(todayDubai);
  const [chequeNo, setChequeNo] = useState("");
  const [chequeBank, setChequeBank] = useState("");
  const [chequeDate, setChequeDate] = useState(todayDubai);
  const [files, setFiles] = useState<JobFile[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<RecordDepositResult, { ok: true }> | null>(null);
  const [sendOpen, setSendOpen] = useState(false);
  // A real uuid: the proof files are tied to it in job_files.ref_id (a uuid column) until the save re-points them.
  const [clientKey] = useState(newUuid);

  const value = Number(amount.replace(/[^\d.]/g, "")) || 0;
  const overBy = Math.max(0, Math.round((value - d.outstanding) * 100) / 100);
  const needsProof = method === "card" || method === "transfer";
  const rule = charges[method];
  const fee = feesFor(value, rule);

  const close = () => {
    setOpen(false);
    setConfirming(false);
    if (done) router.refresh();
  };

  async function record() {
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.set("job_id", d.jobId);
    fd.set("method", method);
    fd.set("amount", amount);
    fd.set("reference", needsAuthCode(method) ? "" : reference);
    fd.set("auth_code", needsAuthCode(method) ? authCode : "");
    fd.set("received_date", date);
    fd.set("client_key", clientKey);
    if (method === "cheque") {
      fd.set("cheque_number", chequeNo);
      fd.set("cheque_bank", chequeBank);
      fd.set("cheque_date", chequeDate);
    }
    const r = await recordDepositPanel(fd).catch((e) => ({ error: reloadIfStale(e) ? "A new version is loading – nothing was recorded, record it again in a moment." : "Couldn't save – nothing was recorded. Try again or tell the owner." }) as RecordDepositResult);
    setBusy(false);
    setConfirming(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setDone(r);
    router.refresh();
  }

  return (
    <>
      <Button type="button" size="md" onClick={() => setOpen(true)} data-record-deposit-open>
        {label}
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label="Record the deposit" onClick={close}>
          <div className="w-full max-w-lg rounded-card bg-white p-5 flex flex-col gap-3 shadow-xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-record-deposit-panel>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-extrabold">Record the deposit</h2>
              <button type="button" onClick={close} aria-label="Close" className="min-h-11 min-w-11 rounded-control text-xl font-bold hover:bg-chip">✕</button>
            </div>
            <p className="text-sm">
              <span className="font-bold">{d.plate}</span>
              {d.car ? <span className="text-muted"> · {d.car}</span> : null}
              {d.customer ? <span className="text-muted"> · {d.customer}</span> : null}
              <span className="text-muted"> · {d.quote}</span>
            </p>
            {done ? (
              <div className="flex flex-col gap-3" data-deposit-done>
                <p className="rounded-control bg-green-soft border border-green px-3 py-2 text-sm font-bold text-green">
                  {done.number} recorded ✓ — {aed(value)} received.
                </p>
                {done.overBy > 0 ? <p className="text-sm font-semibold" data-deposit-over>{aed(done.overBy)} more than requested – kept as an advance on the job.</p> : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="md" onClick={() => setSendOpen(true)} data-send-deposit-receipt>Send receipt</Button>
                  <a href={done.pdfHref} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold">Open receipt (PDF)</a>
                  <Button type="button" tone="ghost" size="md" onClick={close}>Done</Button>
                </div>
                {sendOpen ? <SendLinkDialog title={`Send receipt ${done.number}`} message={done.receiptMessage} phoneDigits={done.phoneDigits} onClose={() => setSendOpen(false)} onSent={() => setSendOpen(false)} /> : null}
              </div>
            ) : (
              <>
                <p className="text-sm font-semibold" data-deposit-asked>
                  Deposit requested: {aed(d.requested)}{d.received > 0 ? ` · ${aed(d.received)} already received` : ""}
                </p>
                <label className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">Amount received (AED)</span>
                  <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className="text-right text-lg font-bold" data-deposit-amount />
                </label>
                {overBy > 0 ? <p className="text-sm font-semibold text-amber-bar" data-deposit-over>{aed(overBy)} more than requested – kept as an advance on the job.</p> : null}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5" data-deposit-methods>
                  {METHODS.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setMethod(v)} aria-pressed={method === v} data-deposit-method={v} className={`min-h-11 rounded-control border-2 px-1 text-xs font-bold ${method === v ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{l}</button>
                  ))}
                </div>
                {feeRuleWords(rule) !== "no bank fee" ? <p className="text-xs text-muted" data-deposit-fee>Bank fee {feeRuleWords(rule)} on {METHODS.find(([v]) => v === method)?.[1].toLowerCase()}{value > 0 ? ` (estimated ${fee.cost.toFixed(2)}${fee.vat > 0 ? ` + VAT ${fee.vat.toFixed(2)}` : ""})` : ""}: internal, counted against profit without the reclaimable VAT.</p> : null}
                {method === "cheque" ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cheque number</span><Input value={chequeNo} onChange={(e) => setChequeNo(e.target.value)} /></label>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Bank</span><Input value={chequeBank} onChange={(e) => setChequeBank(e.target.value)} textCase="title" /></label>
                    <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Cheque date</span><Input type="date" value={chequeDate} onChange={(e) => setChequeDate(e.target.value)} /></label>
                  </div>
                ) : null}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {needsAuthCode(method) ? <AuthCodeInput method={method} value={authCode} onChange={setAuthCode} name="deposit_auth_code" /> : <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Reference (optional)</span><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="transfer ref, cheque bank…" /></label>}
                  <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Date received</span><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} data-deposit-date /></label>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-semibold text-muted">Proof{needsProof ? " (required: the card slip or the transfer screenshot)" : " (optional)"}</span>
                  <JobFileUpload jobId={d.jobId} kind="payment_proof" refId={clientKey} files={files} accept="any" label="Take photo / attach" compact removable onAdded={(f) => setFiles((x) => [...x, f])} onRemoved={(f) => setFiles((x) => x.filter((y) => y.id !== f.id))} />
                </div>
                {error ? <p className="text-sm font-semibold text-red" data-deposit-error>{error}</p> : null}
                {confirming ? (
                  <div className="flex flex-col gap-2 rounded-control border-2 border-ink bg-canvas p-3" data-deposit-confirm>
                    <p className="text-sm font-bold">Record {aed(value)} by {METHODS.find(([v]) => v === method)?.[1].toLowerCase()} as the deposit on {d.plate}? A receipt is made at once.</p>
                    <div className="flex gap-2">
                      <Button type="button" size="md" disabled={busy} onClick={() => void record()} data-deposit-confirm-yes>{busy ? "Recording…" : "Yes, record it"}</Button>
                      <Button type="button" tone="ghost" size="md" onClick={() => setConfirming(false)}>Back</Button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <Button type="button" size="lg" disabled={!(value > 0) || (needsProof && files.length === 0)} onClick={() => setConfirming(true)} data-deposit-record>
                      Record {value > 0 ? aed(value) : "the deposit"}
                    </Button>
                    {needsProof && files.length === 0 ? <p className="mt-1 text-xs font-semibold text-amber-bar">Attach the proof first.</p> : null}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

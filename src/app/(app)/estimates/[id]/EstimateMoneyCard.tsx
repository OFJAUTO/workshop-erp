"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelEstimateMoneyAction, createEstimateProformaAction, estimateProformaSendInfo, markEstimateProformaSent, markEstimatePayLinkSent, prepareEstimatePayLink, settleEstimateOverAction, voidEstimateProformaAction, type ProformaSendInfo } from "../money-actions";
import { RecordPaymentButton } from "@/components/RecordPaymentHost";
import { PaymentReportButton } from "@/components/PaymentReport";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { NumericInput } from "@/components/NumericInput";
import { Badge, Button, Input, SectionLabel } from "@/components/ui";
import type { BillTo } from "@/lib/estimate-money-rules";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type MoneyCardFacts = {
  proforma: { id: string; number: string; total: number; validUntil: string | null; sentAt: string | null; complete: boolean } | null;
  taxes: { id: string; number: string; total: number; advance: boolean; token: string | null }[];
  paid: number;
  pendingCheque: number;
  total: number;
  badgeWords: string | null;
  badgeTone: "green" | "amber" | null;
  paidWords: string | null;
  fullyInvoiced: boolean;
  /** Part 3: paid more than the (revised) bill — the owner settles it with a credit note. */
  over: number;
  /** Part 3: billed on another estimate's combined proforma. */
  combinedOn: { proformaNumber: string; baseNumber: string } | null;
  /** Part 3: accepted additional estimates of the same car that can be billed together on ONE proforma. */
  combineChoices: { id: string; number: string; total: number }[];
};

/**
 * PROFORMA INVOICE from the estimate (4 November 2026): complete or partial (% / AED), the bill-to
 * block (company, address, TRN, attention, PO number — may differ from the car's owner), send through
 * the one dialog, and the money recorded by accounts; the tax invoice follows by itself when paid.
 */
export function EstimateMoneyCard({ estimateId, number, approved, money, billTo, canCreate, canRecord, recordReadOnly, canReport = false, isOwner = false, customerId, vehicleId, phoneDigits }: {
  estimateId: string;
  number: string;
  approved: boolean;
  money: MoneyCardFacts;
  billTo: BillTo;
  canCreate: boolean;
  canRecord: boolean;
  recordReadOnly: boolean;
  /** Advisors (and the owner): "Payment received – send to accounts" on the estimate. */
  canReport?: boolean;
  /** Part 3: the owner settles over-payments and cancels an estimate that holds money. */
  isOwner?: boolean;
  customerId: string;
  vehicleId: string | null;
  phoneDigits: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"complete" | "partial">(approved ? "complete" : "partial");
  const [partialKind, setPartialKind] = useState<"percent" | "aed">("percent");
  const [partialValue, setPartialValue] = useState("");
  const [bt, setBt] = useState<BillTo>(billTo);
  const [error, setError] = useState<string | null>(null);
  const [send, setSend] = useState<ProformaSendInfo | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [voidWhy, setVoidWhy] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkAmount, setLinkAmount] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkSend, setLinkSend] = useState<{ message: string; amount: number; phone: string | null } | null>(null);
  const [combine, setCombine] = useState<Set<string>>(new Set());
  const [overWhy, setOverWhy] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelWhy, setCancelWhy] = useState("");
  const [cancelFee, setCancelFee] = useState("");
  const [cancelKeep, setCancelKeep] = useState<"credit" | "refund">("credit");
  const [done, setDone] = useState<{ words: string; cnId?: string | null } | null>(null);
  const [busy, start] = useTransition();
  // 11 November 2026 (Section 13): the box is ONE bar until opened; it opens by itself while something needs an answer.
  const [opened, setOpened] = useState(false);
  const pro = money.proforma;

  const create = () => start(async () => {
    setError(null);
    const r = await createEstimateProformaAction(estimateId, { mode, partialKind, partialValue: Number(partialValue.replace(/,/g, "")), billTo: bt, combineIds: mode === "complete" ? Array.from(combine) : [] });
    if (r.error) { setError(r.error); return; }
    setSend(r);
    router.refresh();
  });
  const settleOver = (keep: "credit" | "refund") => start(async () => {
    setError(null);
    const r = await settleEstimateOverAction(estimateId, keep, overWhy);
    if (r.error) { setError(r.error); return; }
    setDone({ words: r.words ?? "Settled.", cnId: r.cnId });
    setOverWhy("");
    router.refresh();
  });
  const doCancel = () => start(async () => {
    setError(null);
    const r = await cancelEstimateMoneyAction(estimateId, { reason: cancelWhy, fee: Number(cancelFee.replace(/,/g, "")) || 0, keep: cancelKeep });
    if (r.error) { setError(r.error); return; }
    setDone({ words: r.words ?? "Cancelled.", cnId: r.cnId });
    setCancelOpen(false);
    router.refresh();
  });
  const openSend = () => start(async () => {
    setError(null);
    const r = await estimateProformaSendInfo(estimateId);
    if (r.error) { setError(r.error); return; }
    setSend(r);
  });
  const doVoid = () => start(async () => {
    setError(null);
    const r = await voidEstimateProformaAction(estimateId, pro!.id, voidWhy);
    if (r.error) { setError(r.error); return; }
    setVoiding(false);
    setVoidWhy("");
    router.refresh();
  });
  const doLink = () => start(async () => {
    setError(null);
    const amount = Number(linkAmount.replace(/,/g, "")) || Math.max(0, pro ? pro.total - money.paid : 0);
    const r = await prepareEstimatePayLink(estimateId, amount, linkUrl.trim() === "" ? undefined : linkUrl);
    if (r.error || !r.message) { setError(r.error ?? "Couldn't prepare the link."); return; }
    setLinkSend({ message: r.message, amount: r.amount ?? amount, phone: r.phone ?? null });
    setLinking(false);
  });

  const btBox = (
    <div className="flex flex-col gap-2" data-em-billto>
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Bill to (can differ from the car&apos;s owner)</span>
      <div className="grid gap-2 sm:grid-cols-2">
        <Input placeholder="Company name" value={bt.company} onChange={(e) => setBt({ ...bt, company: e.target.value })} data-em-billto-company />
        <Input placeholder="Attention (person)" value={bt.attention} onChange={(e) => setBt({ ...bt, attention: e.target.value })} data-em-billto-attention />
        <Input placeholder="TRN (15 digits, if VAT-registered)" inputMode="numeric" value={bt.trn} onChange={(e) => setBt({ ...bt, trn: e.target.value })} data-em-billto-trn />
        <Input placeholder="Customer PO / reference number" value={bt.po_number} onChange={(e) => setBt({ ...bt, po_number: e.target.value })} data-em-billto-po />
      </div>
      <Input placeholder="Address" value={bt.address} onChange={(e) => setBt({ ...bt, address: e.target.value })} data-em-billto-address />
    </div>
  );

  const mustOpen = !!error || !!done || !!send || !!linkSend || voiding || cancelOpen || linking;
  return (
    <details className="group rounded-card border border-line bg-white" open={opened || mustOpen} onToggle={(e) => setOpened(e.currentTarget.open)} data-em-card data-fold-bar>
      <summary className="flex min-h-14 cursor-pointer list-none flex-wrap items-center gap-2 px-5 py-3 [&::-webkit-details-marker]:hidden" data-em-bar>
        <SectionLabel>Proforma &amp; payment · car not here yet</SectionLabel>
        {money.badgeWords ? <Badge tone={money.badgeTone === "green" ? "green" : "amber"} data-em-badge={money.badgeWords}>{money.badgeWords}</Badge> : null}
        <span className="ml-auto text-sm font-bold group-open:hidden">Open ▾</span>
        <span className="ml-auto hidden text-sm font-bold group-open:inline">Close ▴</span>
      </summary>
      <div className="flex flex-col gap-3 px-5 pb-5">
      {money.paidWords ? <p className="text-sm font-semibold" data-em-paid>{money.paidWords}</p> : null}
      {money.combinedOn ? <p className="text-sm font-semibold" data-em-combined-on={money.combinedOn.proformaNumber}>Billed on <b>{money.combinedOn.proformaNumber}</b> together with {money.combinedOn.baseNumber} (one combined proforma).</p> : null}
      {done ? (
        <p className="rounded-control border-2 border-green bg-green-soft px-3 py-2 text-sm font-semibold" data-em-done>
          {done.words}{done.cnId ? <> <a className="underline underline-offset-4" href={`/invoices/${done.cnId}`} data-em-cn-open>Open the credit note</a></> : null}
        </p>
      ) : null}
      {money.over > 0.005 && money.pendingCheque <= 0.005 ? (
        <div className="flex flex-col gap-2 rounded-control border-2 border-amber-bar bg-amber-soft p-3" data-em-over={money.over.toFixed(2)}>
          <p className="text-sm font-bold">Paid {aed(money.paid)} against a bill of {aed(money.total)} — {aed(money.over)} over (the estimate was revised down, or paid twice).</p>
          {isOwner ? (
            <>
              <Input placeholder="Why (goes on the credit note), e.g. revised down on the customer's call" value={overWhy} onChange={(e) => setOverWhy(e.target.value)} data-em-over-reason />
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="md" disabled={busy || overWhy.trim().length < 3} onClick={() => settleOver("credit")} data-em-over-credit>Keep as customer credit</Button>
                <Button type="button" size="md" tone="secondary" disabled={busy || overWhy.trim().length < 3} onClick={() => settleOver("refund")} data-em-over-refund>Refund it…</Button>
              </div>
              <p className="text-xs text-muted">Either way a credit note is issued (the VAT paper). A refund is recorded on the credit note&apos;s page with the method and reference.</p>
            </>
          ) : (
            <p className="text-xs text-muted">The owner settles the difference (credit note: refund, or customer credit).</p>
          )}
        </div>
      ) : null}

      {money.taxes.length ? (
        <ul className="flex flex-col gap-1 text-sm">
          {money.taxes.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2" data-em-tax={t.number}>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green text-xs font-bold text-on-dark">✓</span>
              <span className="font-semibold">Tax invoice {t.number}</span>
              <span className="text-muted">{t.advance ? `advance against ${number}` : "the whole bill"} · {aed(t.total)}</span>
              {t.token ? <a className="text-xs font-bold underline underline-offset-4" href={`/api/pdf/invoice/${t.token}`} target="_blank" rel="noreferrer">PDF</a> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {pro ? (
        <div className="flex flex-col gap-2 rounded-control border border-line p-3" data-em-proforma={pro.number}>
          <p className="text-sm">
            <b>{pro.number}</b> · {aed(pro.total)} · {pro.complete ? "the whole bill" : "partial advance"}
            {pro.validUntil ? <span className="text-muted"> · valid until {pro.validUntil}</span> : null}
            {pro.sentAt ? <span className="text-muted"> · sent</span> : <span className="font-semibold text-amber-bar"> · not sent yet</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {canCreate ? <Button type="button" size="md" disabled={busy} onClick={openSend} data-em-send>Send to customer</Button> : null}
            {canCreate ? <Button type="button" tone="secondary" size="md" disabled={busy} onClick={() => { setLinkAmount(String(Math.max(0, pro.total - money.paid).toFixed(2))); setLinking(!linking); }} data-em-paylink>Send payment link</Button> : null}
            {canRecord || recordReadOnly ? <RecordPaymentButton customerId={customerId} vehicleId={vehicleId} readOnly={recordReadOnly} size="md" tone="secondary" /> : null}
            {canReport && !canRecord ? <PaymentReportButton estimateId={estimateId} balance={Math.max(0, pro.total - money.paid)} size="md" /> : null}
            {canRecord && !recordReadOnly ? (
              voiding ? null : <Button type="button" tone="ghost" size="md" onClick={() => setVoiding(true)} data-em-void>Void…</Button>
            ) : null}
          </div>
          {linking ? (
            <div className="flex flex-col gap-2 rounded-control border border-line p-3" data-em-paylink-form>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Amount (complete or partial)</span>
                <NumericInput value={linkAmount} onChange={(e) => setLinkAmount((e.target as HTMLInputElement).value)} style={{ width: "9rem" }} data-em-paylink-amount />
              </div>
              <Input placeholder="Pay-now link from the bank's portal (optional)" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} data-em-paylink-url spell={false} />
              <div className="flex gap-2">
                <Button type="button" size="md" disabled={busy} onClick={doLink} data-em-paylink-go>{busy ? "Preparing…" : "Prepare the message"}</Button>
                <Button type="button" tone="ghost" size="md" onClick={() => setLinking(false)}>Back</Button>
              </div>
            </div>
          ) : null}
          {voiding ? (
            <div className="flex flex-wrap items-center gap-2" data-em-void-form>
              <Input placeholder="Why is it voided? (logged)" value={voidWhy} onChange={(e) => setVoidWhy(e.target.value)} className="flex-1 min-w-56" data-em-void-reason />
              <Button type="button" size="md" tone="secondary" disabled={busy || voidWhy.trim().length < 3} onClick={doVoid} data-em-void-save>Void the proforma</Button>
              <Button type="button" size="md" tone="ghost" onClick={() => { setVoiding(false); setVoidWhy(""); }}>Back</Button>
            </div>
          ) : null}
        </div>
      ) : money.fullyInvoiced ? (
        <p className="text-sm text-muted">The whole bill is invoiced and paid. The money and the invoice follow the car onto the job at gate-in.</p>
      ) : canCreate ? (
        <div className="flex flex-col gap-3" data-em-create>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setMode("complete")} disabled={!approved} aria-pressed={mode === "complete"} data-em-mode="complete" className={`min-h-11 rounded-control border px-4 text-sm font-bold ${mode === "complete" ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"} ${approved ? "" : "opacity-50"}`}>
              COMPLETE – the whole bill{approved ? ` (${aed(money.total)})` : ""}
            </button>
            <button type="button" onClick={() => setMode("partial")} aria-pressed={mode === "partial"} data-em-mode="partial" className={`min-h-11 rounded-control border px-4 text-sm font-bold ${mode === "partial" ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>
              PARTIAL – a deposit
            </button>
          </div>
          {!approved ? <p className="text-xs text-muted">The customer has not accepted yet: only a partial (deposit) proforma can go out.</p> : null}
          {mode === "complete" && money.combineChoices.length ? (
            <div className="flex flex-col gap-1 rounded-control border border-line p-3" data-em-combine-box>
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Bill together on this one proforma (accepted additional estimates of this car)</span>
              {money.combineChoices.map((c) => {
                const on = combine.has(c.id);
                return (
                  <button key={c.id} type="button" onClick={() => setCombine((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })} aria-pressed={on} data-em-combine={c.id} className="flex min-h-11 items-center gap-2 rounded-control px-2 text-left text-sm">
                    <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-control border text-xs font-bold ${on ? "border-ink bg-ink text-on-dark" : "border-line-strong text-transparent"}`}>✓</span>
                    <span className="font-semibold">{c.number}</span>
                    <span className="text-muted">{aed(c.total)}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {mode === "partial" ? (
            <div className="flex flex-wrap items-center gap-2" data-em-partial>
              <span className="inline-flex shrink-0 overflow-hidden rounded-control border border-line-strong">
                <button type="button" onClick={() => setPartialKind("percent")} aria-pressed={partialKind === "percent"} data-em-partial-kind="percent" className={`min-h-11 px-3 text-sm font-bold ${partialKind === "percent" ? "bg-ink text-on-dark" : "bg-white"}`}>%</button>
                <button type="button" onClick={() => setPartialKind("aed")} aria-pressed={partialKind === "aed"} data-em-partial-kind="aed" className={`min-h-11 px-3 text-sm font-bold ${partialKind === "aed" ? "bg-ink text-on-dark" : "bg-white"}`}>AED</button>
              </span>
              <NumericInput value={partialValue} onChange={(e) => setPartialValue((e.target as HTMLInputElement).value)} placeholder={partialKind === "percent" ? "e.g. 50" : "amount"} style={{ width: "9rem" }} data-em-partial-value />
              {partialKind === "percent" && Number(partialValue) > 0 && money.total > 0 ? <span className="text-sm text-muted">= {aed(Math.round(money.total * Number(partialValue)) / 100)}</span> : null}
            </div>
          ) : null}
          {btBox}
          <div><Button type="button" size="lg" disabled={busy} onClick={create} data-em-issue>{busy ? "Preparing…" : "Issue the proforma"}</Button></div>
        </div>
      ) : (
        <p className="text-sm text-muted">No proforma is out. An advisor, accounts or the owner can issue one.</p>
      )}
      {isOwner && money.paid > 0.005 ? (
        <details className="text-sm" open={cancelOpen} onToggle={(e) => setCancelOpen((e.target as HTMLDetailsElement).open)} data-em-cancel>
          <summary className="min-h-11 flex cursor-pointer items-center font-bold text-red" data-em-cancel-open>Cancel this estimate (money is paid on it)…</summary>
          <div className="mt-2 flex flex-col gap-2 rounded-control border-2 border-red-bar p-3">
            <Input placeholder="Why is it cancelled? (logged, on the credit note)" value={cancelWhy} onChange={(e) => setCancelWhy(e.target.value)} data-em-cancel-reason />
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Cancellation fee (AED, optional – stays invoiced)</span>
              <NumericInput value={cancelFee} onChange={(e) => setCancelFee((e.target as HTMLInputElement).value)} style={{ width: "8rem" }} data-em-cancel-fee />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setCancelKeep("credit")} aria-pressed={cancelKeep === "credit"} data-em-cancel-keep="credit" className={`min-h-11 rounded-control border px-3 text-sm font-bold ${cancelKeep === "credit" ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>Keep as customer credit</button>
              <button type="button" onClick={() => setCancelKeep("refund")} aria-pressed={cancelKeep === "refund"} data-em-cancel-keep="refund" className={`min-h-11 rounded-control border px-3 text-sm font-bold ${cancelKeep === "refund" ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`}>Refund the rest</button>
            </div>
            <div><Button type="button" size="md" tone="secondary" disabled={busy || cancelWhy.trim().length < 3} onClick={doCancel} data-em-cancel-save>Cancel the estimate</Button></div>
            <p className="text-xs text-muted">The open proforma is voided (logged). What stands invoiced beyond the fee becomes a credit note — refunded on its page, or kept as the customer&apos;s credit. A cheque still clearing blocks this.</p>
          </div>
        </details>
      ) : null}
      {error ? <p className="text-sm font-semibold text-red" role="alert" data-em-error>{error}</p> : null}

      {send && send.message ? (
        <SendLinkDialog
          title={`Send proforma ${send.number}`}
          message={send.message}
          phoneDigits={phoneDigits}
          pdf={send.token ? { href: `/api/pdf/invoice/${send.token}`, fileName: `OFJ Proforma ${send.number}.pdf` } : null}
          onSent={(how) => { void markEstimateProformaSent(estimateId, send.invoiceId!, how === "whatsapp" ? "WhatsApp" : "copied"); setSend(null); router.refresh(); }}
          onClose={() => setSend(null)}
        />
      ) : null}
      {linkSend ? (
        <SendLinkDialog
          title={`Send the payment link · AED ${linkSend.amount.toLocaleString("en-GB", { minimumFractionDigits: 2 })}`}
          message={linkSend.message}
          phoneDigits={(linkSend.phone ?? "").replace(/[^\d]/g, "") || phoneDigits}
          onSent={() => { void markEstimatePayLinkSent(estimateId, linkSend.amount); setLinkSend(null); router.refresh(); }}
          onClose={() => setLinkSend(null)}
        />
      ) : null}
      </div>
    </details>
  );
}

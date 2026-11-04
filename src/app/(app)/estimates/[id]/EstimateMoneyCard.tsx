"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEstimateProformaAction, estimateProformaSendInfo, markEstimateProformaSent, voidEstimateProformaAction, type ProformaSendInfo } from "../money-actions";
import { RecordPaymentButton } from "@/components/RecordPaymentHost";
import { SendLinkDialog } from "@/components/SendLinkDialog";
import { NumericInput } from "@/components/NumericInput";
import { Badge, Button, Card, Input, SectionLabel } from "@/components/ui";
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
};

/**
 * PROFORMA INVOICE from the estimate (4 November 2026): complete or partial (% / AED), the bill-to
 * block (company, address, TRN, attention, PO number — may differ from the car's owner), send through
 * the one dialog, and the money recorded by accounts; the tax invoice follows by itself when paid.
 */
export function EstimateMoneyCard({ estimateId, number, approved, money, billTo, canCreate, canRecord, recordReadOnly, customerId, vehicleId, phoneDigits }: {
  estimateId: string;
  number: string;
  approved: boolean;
  money: MoneyCardFacts;
  billTo: BillTo;
  canCreate: boolean;
  canRecord: boolean;
  recordReadOnly: boolean;
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
  const [busy, start] = useTransition();
  const pro = money.proforma;

  const create = () => start(async () => {
    setError(null);
    const r = await createEstimateProformaAction(estimateId, { mode, partialKind, partialValue: Number(partialValue.replace(/,/g, "")), billTo: bt });
    if (r.error) { setError(r.error); return; }
    setSend(r);
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

  return (
    <Card className="flex flex-col gap-3" data-em-card>
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel>Proforma &amp; payment · car not here yet</SectionLabel>
        {money.badgeWords ? <Badge tone={money.badgeTone === "green" ? "green" : "amber"} data-em-badge={money.badgeWords}>{money.badgeWords}</Badge> : null}
      </div>
      {money.paidWords ? <p className="text-sm font-semibold" data-em-paid>{money.paidWords}</p> : null}

      {money.taxes.length ? (
        <ul className="flex flex-col gap-1 text-sm">
          {money.taxes.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-2" data-em-tax={t.number}>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-green text-xs font-bold text-white">✓</span>
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
            {canRecord || recordReadOnly ? <RecordPaymentButton customerId={customerId} vehicleId={vehicleId} readOnly={recordReadOnly} size="md" tone="secondary" /> : null}
            {canRecord && !recordReadOnly ? (
              voiding ? null : <Button type="button" tone="ghost" size="md" onClick={() => setVoiding(true)} data-em-void>Void…</Button>
            ) : null}
          </div>
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
            <button type="button" onClick={() => setMode("complete")} disabled={!approved} aria-pressed={mode === "complete"} data-em-mode="complete" className={`min-h-11 rounded-control border px-4 text-sm font-bold ${mode === "complete" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"} ${approved ? "" : "opacity-50"}`}>
              COMPLETE – the whole bill{approved ? ` (${aed(money.total)})` : ""}
            </button>
            <button type="button" onClick={() => setMode("partial")} aria-pressed={mode === "partial"} data-em-mode="partial" className={`min-h-11 rounded-control border px-4 text-sm font-bold ${mode === "partial" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>
              PARTIAL – a deposit
            </button>
          </div>
          {!approved ? <p className="text-xs text-muted">The customer has not accepted yet: only a partial (deposit) proforma can go out.</p> : null}
          {mode === "partial" ? (
            <div className="flex flex-wrap items-center gap-2" data-em-partial>
              <span className="inline-flex shrink-0 overflow-hidden rounded-control border border-line-strong">
                <button type="button" onClick={() => setPartialKind("percent")} aria-pressed={partialKind === "percent"} data-em-partial-kind="percent" className={`min-h-11 px-3 text-sm font-bold ${partialKind === "percent" ? "bg-ink text-white" : "bg-white"}`}>%</button>
                <button type="button" onClick={() => setPartialKind("aed")} aria-pressed={partialKind === "aed"} data-em-partial-kind="aed" className={`min-h-11 px-3 text-sm font-bold ${partialKind === "aed" ? "bg-ink text-white" : "bg-white"}`}>AED</button>
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
    </Card>
  );
}

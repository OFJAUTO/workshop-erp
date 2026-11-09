"use client";

import { useActionState, useState } from "react";
import { Button, Input, Notice } from "@/components/ui";
import { feesFor, feeRuleWords, type FeeRule } from "@/lib/bank-fees";
import { initialFormState, type FormState } from "@/lib/form-state";

export type BankFeeValues = {
  cardMsf: number;
  cardTxn: number;
  cardTerminals: string;
  linkMsf: number;
  linkTxn: number;
  linkTerminals: string;
  vat: number;
  cash: number;
  cheque: number;
  transfer: number;
};

const aed = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n = (t: string) => {
  const v = Number(String(t).replace(",", "."));
  return Number.isFinite(v) ? v : 0;
};

/**
 * THE bank fee settings (29 October 2026), owner and accounts: per method the MSF % before VAT, the fee per
 * transaction and the terminal IDs that recognise the method on the bank's reports, plus the VAT on the fees. A worked
 * example under each method shows what the bank keeps, live, the way its report shows it.
 */
export function BankFeeSettings({ values, action, canSave }: { values: BankFeeValues; action: (s: FormState, f: FormData) => Promise<FormState>; canSave: boolean }) {
  const [state, formAction, pending] = useActionState(action, initialFormState);
  const [v, setV] = useState({
    cardMsf: String(values.cardMsf),
    cardTxn: String(values.cardTxn),
    linkMsf: String(values.linkMsf),
    linkTxn: String(values.linkTxn),
    vat: String(values.vat),
  });
  const rule = (m: "card" | "link"): FeeRule => ({ msfPercent: n(m === "card" ? v.cardMsf : v.linkMsf), txnFee: n(m === "card" ? v.cardTxn : v.linkTxn), vatPercent: n(v.vat), terminals: [] });
  const example = (m: "card" | "link", amount: number) => {
    const f = feesFor(amount, rule(m));
    return `AED ${aed(amount)} → MSF ${aed(f.msf)} + fee ${aed(f.txn)} + VAT ${aed(f.vat)} = ${aed(f.total)} kept, net ${aed(f.net)}. The job's cost is ${aed(f.cost)} (the VAT is reclaimable).`;
  };
  const box = (m: "card" | "link", title: string, sample: number) => (
    <div className="flex flex-col gap-3 rounded-card border border-line p-3" data-fee-method={m}>
      <span className="text-sm font-extrabold">{title}</span>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">MSF % (excl. VAT)</span>
          <Input name={`bank_charge_${m}_percent`} inputMode="decimal" value={m === "card" ? v.cardMsf : v.linkMsf} onChange={(e) => setV((x) => ({ ...x, [m === "card" ? "cardMsf" : "linkMsf"]: e.target.value }))} required data-fee-msf={m} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Transaction fee (AED per transaction)</span>
          <Input name={`bank_fee_${m}_txn_aed`} inputMode="decimal" value={m === "card" ? v.cardTxn : v.linkTxn} onChange={(e) => setV((x) => ({ ...x, [m === "card" ? "cardTxn" : "linkTxn"]: e.target.value }))} required data-fee-txn={m} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Terminal ID(s) on the bank report</span>
          <Input name={`bank_terminal_ids_${m}`} defaultValue={m === "card" ? values.cardTerminals : values.linkTerminals} placeholder="e.g. 12345678, 23456789" spellCheck={false} data-fee-terminals={m} />
        </label>
      </div>
      <p className="text-xs text-muted" data-fee-example={m}>{feeRuleWords(rule(m))}: {example(m, sample)}</p>
    </div>
  );
  return (
    <form action={formAction} className="flex flex-col gap-3" data-bank-fees>
      {box("card", "Card machine", 1470)}
      {box("link", "Payment link", 10000)}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">VAT on the fees %</span>
          <Input name="bank_fee_vat_percent" inputMode="decimal" value={v.vat} onChange={(e) => setV((x) => ({ ...x, vat: e.target.value }))} required data-fee-vat />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Cash %</span>
          <Input name="bank_charge_cash_percent" inputMode="decimal" defaultValue={String(values.cash)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Cheque %</span>
          <Input name="bank_charge_cheque_percent" inputMode="decimal" defaultValue={String(values.cheque)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">Bank transfer %</span>
          <Input name="bank_charge_transfer_percent" inputMode="decimal" defaultValue={String(values.transfer)} required />
        </label>
      </div>
      <p className="text-xs text-muted">Each fee is rounded to the fils, half up, as the bank does; the VAT is worked out on the rounded fees. Payments recorded from now on carry this estimate until their settlement brings the real figures.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" tone="secondary" size="md" disabled={!canSave || pending} data-fee-save>{pending ? "Saving…" : "Save the bank fees"}</Button>
        {!canSave ? <span className="text-sm text-muted">Viewing as someone else: nothing can be saved.</span> : null}
      </div>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      {state.success ? <div data-fee-saved><Notice tone="success">{state.success}</Notice></div> : null}
    </form>
  );
}

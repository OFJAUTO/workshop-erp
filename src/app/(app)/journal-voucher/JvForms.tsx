"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { MoneyDate } from "@/components/MoneyDate";
import { ProofFileInput } from "@/components/ProofFileInput";
import { ChoiceButtons, Input, controlClass } from "@/components/ui";
import { JV_PAID_BY, JV_TYPES, jvTypeLabel, type JvType } from "@/lib/jv-rules";
import { manualJvAction, payJvAction, payLaterJvAction, recordJvAction, reimburseJvAction, voidJvAction, type JvState } from "./actions";

export type ToRecordView = { id: string; jobId: string | null; jobNumber: string | null; car: string | null; type: JvType; description: string; provider: string | null; amount: number; vat: number; trn: string | null; date: string; enteredBy: string | null; receiptUrl: string | null };
type Staff = { id: string; name: string };

const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numOf = (t: string) => Number(String(t).replace(/,/g, "")) || 0;
function todayIso() {
  return new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
}

function Answer({ state, hook }: { state: JvState; hook: string }) {
  if (state?.error) return <p className="rounded-control bg-red-soft px-3 py-2 text-sm font-semibold text-red" data-jv-error={hook}>{state.error}</p>;
  if (state?.ok) return <p className="rounded-control bg-green-soft px-3 py-2 text-sm font-semibold text-green-text" data-jv-done={hook}>{state.message}</p>;
  return null;
}

/** Who paid it - never pre-selected; a staff member's own money asks who (he is reimbursed later). */
function PaidBy({ staff }: { staff: Staff[] }) {
  const [paidBy, setPaidBy] = useState("");
  return (
    <div className="flex flex-col gap-2" data-jv-paid-by>
      <span className="text-xs font-semibold text-muted">Who paid it?</span>
      <div onChange={(e) => setPaidBy((e.target as HTMLInputElement).value)}>
        <ChoiceButtons name="paid_by" columns={2} required options={JV_PAID_BY.map((p) => ({ value: p.key, label: p.label }))} />
      </div>
      {paidBy === "staff" ? (
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">The staff member (reimbursed later)
          <select name="staff_id" required defaultValue="" className={controlClass} data-jv-staff>
            <option value="" disabled>Choose who paid</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      ) : null}
    </div>
  );
}

/** TO RECORD: tick the charges, check each amount against the receipt, then Record (paid) or Pay later. */
export function ToRecordList({ rows, staff }: { rows: ToRecordView[]; staff: Staff[] }) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, { amount: string; vat: string }>>({});
  const [today] = useState(todayIso);
  const [rec, recAction] = useActionState<JvState, FormData>(recordJvAction, null);
  const [later, laterAction] = useActionState<JvState, FormData>(payLaterJvAction, null);
  const val = (r: ToRecordView) => amounts[r.id] ?? { amount: r.amount.toFixed(2), vat: r.vat.toFixed(2) };
  const picked = rows.filter((r) => ticked.has(r.id));
  const lines = JSON.stringify(picked.map((r) => ({ id: r.id, amount: val(r).amount, vat: val(r).vat })));
  const total = useMemo(() => picked.reduce((a, r) => a + numOf(val(r).amount) + numOf(val(r).vat), 0), [picked, amounts]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length) return <p className="text-sm text-muted" data-jv-nothing>Nothing to record: every charge cost entered on a job is on a voucher.</p>;
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 text-sm" data-jv-row={r.id}>
            <label className="flex min-h-11 items-center gap-2 font-bold">
              <input type="checkbox" checked={ticked.has(r.id)} onChange={(e) => { const n = new Set(ticked); if (e.target.checked) n.add(r.id); else n.delete(r.id); setTicked(n); }} className="h-5 w-5 accent-ink" data-jv-tick={r.id} />
              {r.description}
            </label>
            <span className="text-muted">{new Date(`${r.date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · {jvTypeLabel(r.type)}{r.provider ? ` · ${r.provider}` : ""}{r.trn ? ` · TRN ${r.trn}` : ""}</span>
            {r.jobId ? <Link href={`/jobs/${r.jobId}`} className="font-semibold underline underline-offset-4">{r.jobNumber}{r.car ? ` · ${r.car}` : ""}</Link> : null}
            {r.enteredBy ? <span className="text-xs text-muted">entered by {r.enteredBy}</span> : null}
            {r.receiptUrl ? <a href={r.receiptUrl} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4" data-jv-receipt>Receipt</a> : <span className="text-xs font-semibold text-amber-text" data-jv-no-receipt>No receipt photo</span>}
            <span className="ml-auto flex items-center gap-1.5">
              <label className="flex items-center gap-1 text-xs text-muted">AED <input value={val(r).amount} onChange={(e) => setAmounts({ ...amounts, [r.id]: { ...val(r), amount: e.target.value.replace(/[^0-9.,]/g, "") } })} inputMode="decimal" aria-label={`Amount for ${r.description}`} className="h-11 rounded-control border border-line-strong px-2 text-right text-sm" style={{ width: "6.5rem" }} data-jv-amount={r.id} data-spell="" /></label>
              <label className="flex items-center gap-1 text-xs text-muted">VAT <input value={val(r).vat} onChange={(e) => setAmounts({ ...amounts, [r.id]: { ...val(r), vat: e.target.value.replace(/[^0-9.,]/g, "") } })} inputMode="decimal" aria-label={`VAT for ${r.description}`} className="h-11 rounded-control border border-line-strong px-2 text-right text-sm" style={{ width: "5rem" }} data-jv-vat={r.id} data-spell="" /></label>
            </span>
            {numOf(val(r).amount) !== r.amount ? <span className="basis-full text-xs font-semibold text-amber-text" data-jv-corrected={r.id}>Cost corrected from the receipt: {fmt(r.amount)} → {fmt(numOf(val(r).amount))} (the job&apos;s cost follows when it is recorded)</span> : null}
          </li>
        ))}
      </ul>
      <p className="text-sm font-semibold" data-jv-ticked>{picked.length} ticked · AED {fmt(total)} with VAT</p>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <form action={recAction} className="flex flex-col gap-3 rounded-control border-2 border-ink p-3" data-jv-record-form>
          <span className="text-sm font-extrabold uppercase tracking-[0.06em]">Record as paid</span>
          <p className="text-xs text-muted">One voucher (JV-…) for each ticked charge.</p>
          <input type="hidden" name="lines" value={lines} />
          <PaidBy staff={staff} />
          <MoneyDate name="paid_on" label="Payment date" defaultValue={today} max={today} hook="data-jv-date" />
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Reference (optional)<Input name="reference" spell={false} placeholder="receipt no., card slip, transfer ref" data-jv-reference /></label>
          <ProofFileInput label="Proof (receipt, card slip, transfer slip) – optional" required={false} />
          <ConfirmSubmit label={`Record ${picked.length || ""} voucher${picked.length === 1 ? "" : "s"}`.replace("  ", " ")} title={`Record ${picked.length} journal voucher${picked.length === 1 ? "" : "s"}?`} lines={[`AED ${fmt(total)} with VAT`, "the job's cost follows any amount you corrected"]} live={[{ field: "paid_by" }, { label: "on", field: "paid_on" }, { label: "ref", field: "reference" }, { field: "proof", proof: true }]} confirmLabel="YES, RECORD" cancelLabel="GO BACK AND EDIT" disabled={!picked.length} hook="jv-record" />
          <Answer state={rec} hook="record" />
        </form>
        <form action={laterAction} className="flex flex-col gap-3 rounded-control border border-line-strong p-3" data-jv-later-form>
          <span className="text-sm font-extrabold uppercase tracking-[0.06em]">Pay later (the provider bills monthly)</span>
          <p className="text-xs text-muted">Every ticked charge on the provider&apos;s ONE invoice: one voucher, paid later from the &quot;Pay later&quot; list.</p>
          <input type="hidden" name="lines" value={lines} />
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Provider<Input name="provider" required textCase="upper" defaultValue={picked[0]?.provider ?? ""} key={picked[0]?.id ?? "none"} data-jv-later-provider /></label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Invoice number<Input name="invoice_number" required spell={false} data-jv-later-number /></label>
            <MoneyDate name="invoice_date" label="Invoice date" max={today} hook="data-jv-later-date" />
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Provider TRN (optional)<Input name="trn" spell={false} inputMode="numeric" /></label>
          <ConfirmSubmit label="Keep as pay later" title={`Keep ${picked.length} charge${picked.length === 1 ? "" : "s"} as one unpaid invoice?`} lines={[`AED ${fmt(total)} with VAT`]} live={[{ label: "provider", field: "provider" }, { label: "invoice", field: "invoice_number" }]} confirmLabel="YES, KEEP IT" cancelLabel="GO BACK AND EDIT" tone="secondary" disabled={!picked.length} hook="jv-later" />
          <Answer state={later} hook="later" />
        </form>
      </div>
    </div>
  );
}

/** Pay a "pay later" voucher. */
export function PayVoucherForm({ id, number, total, staff }: { id: string; number: string; total: number; staff: Staff[] }) {
  const [state, action] = useActionState<JvState, FormData>(payJvAction.bind(null, id), null);
  const [today] = useState(todayIso);
  return (
    <details className="basis-full" data-jv-pay={number}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-bold underline underline-offset-4 [&::-webkit-details-marker]:hidden">Record payment</summary>
      <form action={action} className="mt-2 flex max-w-xl flex-col gap-3 rounded-control border border-line bg-white p-3">
        <PaidBy staff={staff} />
        <MoneyDate name="paid_on" label="Payment date" defaultValue={today} max={today} hook="data-jv-pay-date" />
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Reference (optional)<Input name="reference" spell={false} /></label>
        <ProofFileInput label="Proof (optional)" required={false} />
        <ConfirmSubmit label="Record the payment" title={`Pay ${number} – AED ${fmt(total)}?`} lines={[]} live={[{ field: "paid_by" }, { label: "on", field: "paid_on" }]} confirmLabel="YES, RECORD" cancelLabel="GO BACK AND EDIT" size="md" hook="jv-pay" />
        <Answer state={state} hook="pay" />
      </form>
    </details>
  );
}

/** Mark one staff member's vouchers reimbursed. */
export function ReimburseForm({ ids, name, total }: { ids: string[]; name: string; total: number }) {
  const [state, action] = useActionState<JvState, FormData>(reimburseJvAction.bind(null, ids), null);
  const [today] = useState(todayIso);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" data-jv-reimburse={name}>
      <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Paid back by</span><ChoiceButtons name="method" columns={2} required options={[{ value: "cash", label: "Cash" }, { value: "transfer", label: "Bank transfer" }]} /></div>
      <MoneyDate name="paid_on" label="On" defaultValue={today} max={today} />
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Reference<Input name="reference" spell={false} className="w-40" /></label>
      <ConfirmSubmit label="Mark reimbursed" title={`Reimburse ${name} AED ${fmt(total)}?`} lines={[`${ids.length} voucher${ids.length === 1 ? "" : "s"}`]} live={[{ field: "method" }]} confirmLabel="YES, REIMBURSED" cancelLabel="GO BACK" size="md" hook="jv-reimburse" />
      <Answer state={state} hook="reimburse" />
    </form>
  );
}

/** Void a voucher with a reason. */
export function VoidVoucherForm({ id, number }: { id: string; number: string }) {
  const [state, action] = useActionState<JvState, FormData>(voidJvAction.bind(null, id), null);
  return (
    <details data-jv-void={number}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-xs font-bold text-red underline underline-offset-4 [&::-webkit-details-marker]:hidden">Void</summary>
      <form action={action} className="mt-1 flex flex-wrap items-center gap-2">
        <Input name="reason" required minLength={5} placeholder="Why? (kept in the history)" className="w-64" textCase="sentence" />
        <ConfirmSubmit label="Void it" title={`Void ${number}?`} lines={["its charge goes back to record"]} live={[{ label: "why:", field: "reason" }]} confirmLabel="Yes, void it" tone="danger" size="md" hook="jv-void" />
        <Answer state={state} hook="void" />
      </form>
    </details>
  );
}

/** A manual voucher: an expense not tied to a car. */
export function ManualVoucherForm({ staff }: { staff: Staff[] }) {
  const [state, action] = useActionState<JvState, FormData>(manualJvAction, null);
  const [today] = useState(todayIso);
  return (
    <form action={action} className="flex flex-col gap-3" data-jv-manual-form>
      <div className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Type</span><ChoiceButtons name="type" columns={4} required options={JV_TYPES.map((t) => ({ value: t.key, label: t.label.replace(" charges", "") }))} /></div>
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">What was it for?<Input name="description" required minLength={3} textCase="sentence" data-jv-manual-description /></label>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Amount (before VAT)<Input name="amount" required inputMode="decimal" spell={false} data-jv-manual-amount /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">VAT<Input name="vat" inputMode="decimal" spell={false} defaultValue="0" /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Provider<Input name="provider" textCase="upper" /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Provider TRN<Input name="trn" inputMode="numeric" spell={false} /></label>
      </div>
      <PaidBy staff={staff} />
      <MoneyDate name="paid_on" label="Payment date" defaultValue={today} max={today} hook="data-jv-manual-date" />
      <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Reference (optional)<Input name="reference" spell={false} /></label>
      <ProofFileInput label="Proof (optional)" required={false} />
      <div><ConfirmSubmit label="Record the voucher" title="Record a journal voucher (no car)?" lines={[]} live={[{ field: "type" }, { label: "AED", field: "amount" }, { field: "paid_by" }]} confirmLabel="YES, RECORD" cancelLabel="GO BACK AND EDIT" hook="jv-manual" /></div>
      <Answer state={state} hook="manual" />
    </form>
  );
}

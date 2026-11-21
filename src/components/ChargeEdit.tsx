"use client";

import { useActionState, useState } from "react";
import { editChargeAction, type ChargeEditState } from "@/app/(app)/jobs/charge-actions";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { ProviderPicker, type ProviderOption } from "@/components/ProviderPicker";
import { controlClass } from "@/components/ui";
import { CHARGE_KINDS } from "@/lib/charge-rules";

export type ChargeEditValues = { description: string; kind: string; trips: number | null; charge: number; free: boolean; cost: number; note: string | null; supplierId: string | null; provider: string | null; trn: string | null };
export type ChargeHistoryView = { at: string; by: string; changes: { label: string; old: string; new: string }[] };

const money = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * "Edit" on a saved charge (21 November 2026, Section 1): description, type, trips, what the customer pays and the Free
 * tick (locked once the customer saw them on the check-in, a quotation or an invoice), the provider from the supplier
 * list, the cost (locked for advisors once accounts recorded it in a Journal Voucher), the note. The bill is attached on
 * the charge's own row. Every change goes to the history below (who, when, old value, new value).
 */
export function ChargeEdit({ jobId, lineId, values, customerLocked, costLocked, voucher, providers, history }: { jobId: string; lineId: string; values: ChargeEditValues; customerLocked: string | null; costLocked: string | null; voucher: string | null; providers: ProviderOption[]; history: ChargeHistoryView[] }) {
  const [state, action] = useActionState<ChargeEditState, FormData>(editChargeAction.bind(null, jobId, lineId), null);
  const [kind, setKind] = useState(values.kind);
  const [free, setFree] = useState(values.free);
  return (
    <details className="group" data-charge-edit={lineId} open={state?.error ? true : undefined}>
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center rounded-control border border-line-strong px-4 text-sm font-bold [&::-webkit-details-marker]:hidden" data-charge-edit-open>Edit</summary>
      <form action={action} className="mt-2 flex max-w-2xl flex-col gap-3 rounded-control border border-line bg-white p-3" data-charge-edit-form>
        {customerLocked ? <p className="rounded-control bg-amber-soft px-3 py-2 text-xs font-semibold text-amber-text" data-charge-edit-customer-locked>{customerLocked} The provider, cost, note and bill can still be corrected.</p> : <p className="text-xs text-muted" data-charge-edit-internal>Internal: the customer has not seen this charge yet, so everything can change.</p>}
        {customerLocked ? (
          <>
            <input type="hidden" name="description" value={values.description} />
            <input type="hidden" name="kind" value={values.kind} />
            {values.trips !== null ? <input type="hidden" name="trips" value={String(values.trips)} /> : null}
            <input type="hidden" name="charge" value={String(values.charge)} />
            {values.free ? <input type="hidden" name="free" value="on" /> : null}
            <p className="text-sm"><b className="uppercase">{values.description}</b> · {CHARGE_KINDS.find((k) => k.key === values.kind)?.label ?? values.kind} · customer pays {values.free ? "nothing (free)" : `AED ${money(values.charge)} + VAT`}</p>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Description (what the customer reads)
              <input name="description" defaultValue={values.description} required minLength={2} className={`${controlClass} uppercase`} data-spell="" data-charge-edit-description />
            </label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Type
                <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={controlClass} data-charge-edit-kind>
                  {CHARGE_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
                </select>
              </label>
              {kind === "recovery" ? (
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Trips
                  <input name="trips" type="number" min={1} defaultValue={values.trips ?? 1} className={controlClass} data-charge-edit-trips />
                </label>
              ) : null}
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Customer pays (before VAT)
                <input name="charge" inputMode="decimal" defaultValue={values.free ? "0" : money(values.charge)} disabled={free} className={controlClass} spellCheck={false} data-charge-edit-charge />
              </label>
            </div>
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input type="checkbox" name="free" checked={free} onChange={(e) => setFree(e.target.checked)} className="h-5 w-5 accent-ink" data-charge-edit-free />
              Free (the customer pays nothing{free && !values.free ? "; the owner approves it" : ""})
            </label>
          </>
        )}
        <ProviderPicker providers={providers} initial={{ id: values.supplierId, name: values.provider, trn: values.trn }} hook="charge-edit" />
        {costLocked ? (
          <>
            <input type="hidden" name="cost" value={String(values.cost)} />
            <p className="text-sm" data-charge-edit-cost-locked>Cost (we pay): <b>AED {money(values.cost)}</b> · {costLocked}</p>
          </>
        ) : (
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Cost (we pay, before VAT){voucher ? ` – recorded in ${voucher}: the voucher changes with it` : ""}
            <input name="cost" inputMode="decimal" defaultValue={money(values.cost)} required className={controlClass} spellCheck={false} data-charge-edit-cost />
          </label>
        )}
        <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Note (internal)
          <textarea name="note" defaultValue={values.note ?? ""} rows={2} className={`${controlClass} h-auto py-2`} data-spell="" data-charge-edit-note />
        </label>
        <div>
          <ConfirmSubmit label="Save the changes" title="Save the changes to this charge?" lines={["every change is kept in the charge's history (who, when, old and new)", ...(voucher ? [`${voucher} follows a changed cost`] : [])]} live={[{ label: "cost AED", field: "cost" }]} confirmLabel="YES, SAVE" cancelLabel="GO BACK AND EDIT" size="md" hook="charge-edit" />
        </div>
        {state?.error ? <p className="text-sm font-bold text-red" data-charge-edit-error>{state.error}</p> : null}
        {state?.ok ? <p className="text-sm font-bold text-green-text" data-charge-edit-done>{state.message}</p> : null}
      </form>
      {history.length ? (
        <ul className="mt-2 flex flex-col gap-0.5" data-charge-history>
          {history.map((h, i) => (
            <li key={i} className="text-xs text-muted" data-charge-history-entry>
              {new Date(h.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dubai" })} · {h.by}: {h.changes.map((c) => `${c.label} ${c.old} → ${c.new}`).join("; ")}
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

"use client";

import { useActionState, useState } from "react";
import { Button, Input } from "@/components/ui";
import { createLatheAction, latheBackAction, latheBillPaidAction, recordLatheBillAction, saveLatheSettingsAction, type LatheAnswer } from "@/app/(app)/parts/lathe-actions";
import type { LatheItem } from "@/lib/lathe-rules";
import { latheCost } from "@/lib/lathe-rules";

/* Outsourced lathe work (9 November 2026, Section 8): the screen pieces. Every answer shows next to its button. */

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function Answer({ s }: { s: LatheAnswer | null }) {
  if (!s) return null;
  return s.error ? <p className="text-sm font-semibold text-red" data-lathe-error>{s.error}</p> : s.message ? <p className="rounded-control border border-green bg-green-soft px-3 py-2 text-sm font-bold text-green-text" data-lathe-done>{s.message}</p> : null;
}

/** "Outsourced – lathe" on a car's parts page: what, how many, which lathe shop, the day sent and who took it. */
export function LatheTicketForm({ jobId, items, suppliers, today, minMarkup }: { jobId: string; items: LatheItem[]; suppliers: string[]; today: string; minMarkup: number }) {
  const [open, setOpen] = useState(false);
  const [item, setItem] = useState("");
  const [state, action, busy] = useActionState(createLatheAction.bind(null, jobId), null);
  const listed = items.find((i) => i.item.toLowerCase() === item.trim().toLowerCase()) ?? null;
  return (
    <div className="flex flex-col gap-2" data-lathe-ticket-form>
      {!open ? <Button type="button" size="md" tone="secondary" onClick={() => setOpen(true)} data-lathe-open>+ Outsourced – lathe</Button> : (
        <form action={action} className="flex flex-col gap-3 rounded-control border-2 border-line-strong bg-white p-3">
          <span className="text-sm font-bold">Outsourced – lathe (gets a SUB- ticket on its sticker)</span>
          <div className="flex flex-wrap gap-2">
            {items.map((i) => <button key={i.item} type="button" onClick={() => setItem(i.item)} aria-pressed={item === i.item} className={`min-h-11 rounded-control border px-3 text-sm font-bold ${item === i.item ? "border-ink bg-ink text-on-dark" : "border-line-strong bg-white"}`} data-lathe-item={i.item}>{i.item} · {aed(latheCost(i))}</button>)}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">What</span><Input name="item" value={item} onChange={(e) => setItem(e.target.value)} required className="w-56" data-lathe-what /></label>
            {!listed ? <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Cost each (not on the list)</span><Input name="cost" inputMode="decimal" className="w-32" data-lathe-cost /></label> : <span className="text-sm text-muted" data-lathe-cost-listed>Cost {aed(latheCost(listed))} each · customer at least {aed(latheCost(listed) * (1 + minMarkup / 100))}</span>}
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Qty</span><Input name="qty" inputMode="numeric" defaultValue="1" className="w-20" data-lathe-qty /></label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Lathe shop</span>
              <select name="supplier" required defaultValue={suppliers[0] ?? ""} className="min-h-11 w-56 rounded-control border border-line-strong bg-white px-2 text-sm" data-lathe-supplier>
                {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Sent on</span><Input name="sent_on" type="date" required defaultValue={today} max={today} className="w-44" data-lathe-sent /></label>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Who took it</span><Input name="taken_by" required className="w-44" data-lathe-taken /></label>
          </div>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">What the customer reads (optional)</span><Input name="service" placeholder={listed?.service ?? "e.g. Brake disc resurfacing"} className="w-full" data-lathe-service /></label>
          <div className="flex gap-2"><Button type="submit" size="md" disabled={busy} data-lathe-save>{busy ? "Saving…" : "Record the ticket"}</Button><Button type="button" size="md" tone="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
        </form>
      )}
      <Answer s={state} />
    </div>
  );
}

export function LatheBackButton({ partId }: { partId: string }) {
  const [state, setState] = useState<LatheAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  if (state?.message) return <span className="text-xs font-bold text-green-text" data-lathe-back-done>{state.message}</span>;
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" size="md" tone="secondary" disabled={busy} onClick={async () => { setBusy(true); setState(await latheBackAction(partId)); setBusy(false); }} data-lathe-back={partId}>Back from the lathe</Button>
      {state?.error ? <span className="text-xs font-semibold text-red">{state.error}</span> : null}
    </span>
  );
}

export type BillTicketRow = { partId: string; label: string; estimate: number };

/** The month-end bill: the bill's facts, the tickets it covers (amount typed when itemised), lines with no ticket. */
export function LatheBillForm({ suppliers, tickets, today }: { suppliers: string[]; tickets: BillTicketRow[]; today: string }) {
  const [state, action, busy] = useActionState(recordLatheBillAction, null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState(1);
  return (
    <form action={action} className="flex flex-col gap-3" data-lathe-bill-form>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Lathe shop</span>
          <select name="supplier" required defaultValue={suppliers[0] ?? ""} className="min-h-11 w-56 rounded-control border border-line-strong bg-white px-2 text-sm" data-lathe-bill-supplier>{suppliers.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Bill number</span><Input name="bill_number" required className="w-40" data-lathe-bill-number /></label>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Bill date</span><Input name="bill_date" type="date" required max={today} className="w-44" data-lathe-bill-date /></label>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Before VAT</span><Input name="before_vat" inputMode="decimal" required className="w-32" data-lathe-bill-net /></label>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">VAT as printed</span><Input name="vat" inputMode="decimal" defaultValue="0" className="w-28" data-lathe-bill-vat /></label>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase text-muted">Tickets this bill covers (type the amount when the bill lists it; empty = shared by estimate)</span>
        {tickets.length ? tickets.map((t) => (
          <label key={t.partId} className="flex flex-wrap items-center gap-2 rounded-control border border-line px-3 py-2 text-sm">
            <input type="checkbox" name="ticket" value={t.partId} checked={ticked.has(t.partId)} onChange={(e) => setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(t.partId); else n.delete(t.partId); return n; })} className="h-5 w-5 accent-ink" data-lathe-bill-tick={t.label.split(" ")[0]} />
            <input type="hidden" name={`estimate_${t.partId}`} value={t.estimate} />
            <span className="min-w-0 flex-1">{t.label} · estimate {aed(t.estimate)}</span>
            <Input name={`amount_${t.partId}`} inputMode="decimal" placeholder="Amount" className="w-28" data-lathe-bill-amount={t.label.split(" ")[0]} />
          </label>
        )) : <p className="text-sm text-muted">No open tickets.</p>}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase text-muted">Bill lines with no ticket (the parts desk is told)</span>
        {Array.from({ length: extras }).map((_, i) => (
          <div key={i} className="flex flex-wrap gap-2"><Input name="extra_desc" placeholder="What the bill says" className="w-64" data-lathe-extra-desc /><Input name="extra_amount" inputMode="decimal" placeholder="Amount" className="w-28" data-lathe-extra-amount /></div>
        ))}
        <button type="button" onClick={() => setExtras((n) => n + 1)} className="self-start text-sm font-semibold underline underline-offset-4">+ another line</button>
      </div>
      <div><Button type="submit" size="md" disabled={busy || !ticked.size} data-lathe-bill-save>{busy ? "Saving…" : `Record the bill (${ticked.size} ticket${ticked.size === 1 ? "" : "s"})`}</Button></div>
      <Answer s={state} />
    </form>
  );
}

export function LathePaidForm({ billId, today }: { billId: string; today: string }) {
  const [state, action, busy] = useActionState(latheBillPaidAction.bind(null, billId), null);
  if (state?.message) return <Answer s={state} />;
  return (
    <form action={action} className="flex flex-wrap items-end gap-2" data-lathe-paid-form>
      <select name="method" defaultValue="transfer" className="min-h-11 rounded-control border border-line-strong bg-white px-2 text-sm"><option value="transfer">Bank transfer</option><option value="cheque">Cheque</option><option value="card">Card</option><option value="cash">Cash</option></select>
      <Input name="paid_on" type="date" required max={today} className="w-44" />
      <Input name="reference" placeholder="Reference" className="w-36" />
      <Button type="submit" size="md" tone="secondary" disabled={busy}>Paid (one payment)</Button>
      <Answer s={state} />
    </form>
  );
}

export function LatheSettingsForm({ text, threshold, minMarkup, isOwner }: { text: string; threshold: number; minMarkup: number; isOwner: boolean }) {
  const [state, action, busy] = useActionState(saveLatheSettingsAction, null);
  return (
    <form action={action} className="flex flex-col gap-2" data-lathe-settings>
      <span className="text-xs text-muted">One line per item: <b>item | price</b>, or a range <b>item | 150-250</b> (the cost is the highest), optionally <b>| what the customer reads</b>.</span>
      <textarea name="price_list" defaultValue={text} rows={6} className="rounded-control border border-line-strong px-3 py-2 font-mono text-sm" data-spell="" data-lathe-price-list />
      {isOwner ? (
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">No LPO approval under (AED cost)</span><Input name="threshold" inputMode="decimal" defaultValue={String(threshold)} className="w-32" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Minimum markup (%)</span><Input name="min_markup" inputMode="decimal" defaultValue={String(minMarkup)} className="w-28" /></label>
        </div>
      ) : null}
      <div><Button type="submit" size="md" disabled={busy} data-lathe-settings-save>{busy ? "Saving…" : "Save"}</Button></div>
      <Answer s={state} />
    </form>
  );
}

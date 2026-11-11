"use client";

import { useActionState, useMemo, useState } from "react";
import { Button, Input } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { JobFileUpload, type JobFile } from "@/components/JobFileUpload";
import { editLatheBillAction, recordLatheBillAction, voidLatheBillAction, type LatheAnswer } from "@/app/(app)/parts/lathe-actions";
import { latheBillQuestion } from "@/lib/lathe-rules";
import { invoiceDateWarning } from "@/lib/supplier-payment-rules";

/*
 * LATHE BILLS (11 November 2026, Section 6, KA-673205). One form to enter a lathe shop's bill, starting from the parts
 * desk's open tickets grouped by shop: the shop box starts EMPTY and lists only lathe shops with their open ticket
 * counts; the tickets of the chosen shop are ticked; number, date and amounts typed; one confirm sentence with every
 * warning (0 tickets, amount differs from the tickets, the same number twice, a suspicious date). The bill rows below:
 * correct while unpaid and not in Zoho (logged), void with a reason (the owner approves once paid or in Zoho), attach
 * the invoice (photo or PDF, the supplier-invoice upload; a new file never replaces the old one). Paid only through
 * the Supplier payments tab.
 */

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num = (t: string) => Number(String(t).replace(/,/g, "")) || 0;
function Answer({ s }: { s: LatheAnswer | null }) {
  if (!s) return null;
  return s.error ? <p className="text-sm font-semibold text-red" data-lathe-error>{s.error}</p> : s.message ? <p className="rounded-control border border-green bg-green-soft px-3 py-2 text-sm font-bold text-green-text" data-lathe-done>{s.message}</p> : null;
}

export type LatheShop = { name: string; open: number };
export type LatheOpenTicket = { partId: string; shop: string; label: string; estimate: number; sentAt: string | null };

export function LatheBillEntry({ shops, tickets, today, existing }: { shops: LatheShop[]; tickets: LatheOpenTicket[]; today: string; /** "<SHOP>|<NUMBER>" of bills already entered, for the duplicate warning. */ existing: string[] }) {
  const [state, action, busy] = useActionState(recordLatheBillAction, null);
  const [shop, setShop] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [number, setNumber] = useState("");
  const [date, setDate] = useState("");
  const [net, setNet] = useState("");
  const [vat, setVat] = useState("0");
  const [extras, setExtras] = useState(1);
  const mine = useMemo(() => tickets.filter((t) => t.shop.toUpperCase() === shop.toUpperCase()), [tickets, shop]);
  const chosen = mine.filter((t) => ticked.has(t.partId));
  const ticketsTotal = Math.round(chosen.reduce((a, t) => a + t.estimate, 0) * 100) / 100;
  const firstSent = chosen.map((t) => t.sentAt).filter((x): x is string => !!x).sort()[0] ?? null;
  const q = latheBillQuestion({ shop, number: number.trim(), total: num(net) + num(vat), beforeVat: num(net), tickets: chosen.length, ticketsTotal, duplicate: existing.includes(`${shop.trim().toUpperCase()}|${number.trim().toUpperCase()}`), dateWarning: date ? invoiceDateWarning(date, firstSent ? firstSent.slice(0, 10) : null, today) : null });
  const ready = !!shop && !!number.trim() && !!date && num(net) > 0;
  return (
    <form action={action} className="flex flex-col gap-3" data-lathe-bill-form>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase text-muted">Lathe shop</span>
        <select name="supplier" required value={shop} onChange={(e) => { setShop(e.target.value); setTicked(new Set()); }} className="min-h-11 w-full max-w-md rounded-control border border-line-strong bg-white px-2 text-sm" data-lathe-bill-supplier>
          <option value="" disabled>Choose the lathe shop</option>
          {shops.map((s) => <option key={s.name} value={s.name}>{s.name} · {s.open} open ticket{s.open === 1 ? "" : "s"}</option>)}
        </select>
      </label>
      {shop ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-muted">{shop}&apos;s open tickets this bill covers (type the amount when the bill lists it; empty = shared by estimate)</span>
          {mine.length ? mine.map((t) => (
            <label key={t.partId} className="flex flex-wrap items-center gap-2 rounded-control border border-line px-3 py-2 text-sm">
              <input type="checkbox" name="ticket" value={t.partId} checked={ticked.has(t.partId)} onChange={(e) => setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(t.partId); else n.delete(t.partId); return n; })} className="h-5 w-5 accent-ink" data-lathe-bill-tick={t.label.split(" ")[0]} />
              <input type="hidden" name={`estimate_${t.partId}`} value={t.estimate} />
              <span className="min-w-0 flex-1">{t.label} · estimate {aed(t.estimate)}</span>
              <Input name={`amount_${t.partId}`} inputMode="decimal" placeholder="Amount" className="w-28" data-lathe-bill-amount={t.label.split(" ")[0]} />
            </label>
          )) : <p className="text-sm text-muted" data-lathe-no-open>No open tickets with {shop}.</p>}
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Bill number</span><Input name="bill_number" required value={number} onChange={(e) => setNumber(e.target.value)} className="w-40" data-lathe-bill-number /></label>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Bill date</span><Input name="bill_date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} max={today} className="w-44" data-lathe-bill-date /></label>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Before VAT</span><Input name="before_vat" inputMode="decimal" required value={net} onChange={(e) => setNet(e.target.value)} className="w-32" data-lathe-bill-net /></label>
        <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">VAT as printed</span><Input name="vat" inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} className="w-28" data-lathe-bill-vat /></label>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase text-muted">Bill lines with no ticket (the parts desk is told)</span>
        {Array.from({ length: extras }).map((_, i) => (
          <div key={i} className="flex flex-wrap gap-2"><Input name="extra_desc" placeholder="What the bill says" className="w-64" data-lathe-extra-desc /><Input name="extra_amount" inputMode="decimal" placeholder="Amount" className="w-28" data-lathe-extra-amount /></div>
        ))}
        <button type="button" onClick={() => setExtras((n) => n + 1)} className="inline-flex min-h-11 items-center self-start text-sm font-semibold underline underline-offset-4">+ another line</button>
      </div>
      {q.warnings.length && ready ? <ul className="flex flex-col gap-1 rounded-control border border-amber-bar bg-amber-soft px-3 py-2 text-sm font-semibold text-amber-text" data-lathe-bill-warnings>{q.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
      <div>
        <ConfirmSubmit label={busy ? "Saving…" : `Record the bill (${chosen.length} ticket${chosen.length === 1 ? "" : "s"})`} title={q.title} lines={q.warnings.length ? q.warnings : ["Everything matches."]} confirmLabel="Yes, record it" hook="lathe-bill" attrs={{ "data-lathe-bill-save": "", ...(!ready || busy ? { disabled: "" } : {}) }} />
      </div>
      <Answer s={state} />
    </form>
  );
}

export type LatheBillView = { id: string; shop: string; number: string; date: string; beforeVat: number; vat: number; total: number; paid: boolean; inZoho: boolean; voided: boolean; voidAsked: boolean; tickets: number; hasFile: boolean; files: JobFile[]; history: { at: string; by: string; remark: string; changes: { field: string; old: unknown; new: unknown }[] }[] };

/** One bill: correct (unpaid, not in Zoho), void (reason; the owner approves once paid or in Zoho), attach the invoice. */
export function LatheBillRow({ bill, shops, isOwner }: { bill: LatheBillView; shops: LatheShop[]; isOwner: boolean }) {
  const [open, setOpen] = useState<"edit" | "void" | "attach" | null>(null);
  const [eState, eAction, eBusy] = useActionState(editLatheBillAction.bind(null, bill.id), null);
  const [vState, vAction, vBusy] = useActionState(voidLatheBillAction.bind(null, bill.id), null);
  const editable = !bill.paid && !bill.inZoho && !bill.voided;
  return (
    <div className="flex flex-col gap-2">
      {!bill.voided ? (
        <div className="flex flex-wrap gap-2">
          {editable ? <Button type="button" size="md" tone="secondary" onClick={() => setOpen(open === "edit" ? null : "edit")} data-lathe-edit-open={bill.number}>Correct</Button> : null}
          {!bill.voidAsked ? <Button type="button" size="md" tone="ghost" onClick={() => setOpen(open === "void" ? null : "void")} data-lathe-void-open={bill.number}>Void{editable || isOwner ? "" : " (owner approves)"}</Button> : null}
          <Button type="button" size="md" tone={bill.hasFile ? "ghost" : "secondary"} onClick={() => setOpen(open === "attach" ? null : "attach")} data-lathe-attach-open={bill.number}>{bill.hasFile ? "Add another file" : "Attach invoice"}</Button>
        </div>
      ) : null}
      {open === "edit" && editable && !eState?.message ? (
        <form action={eAction} className="flex flex-wrap items-end gap-2 rounded-control border border-line bg-white p-3" data-lathe-edit-form>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Lathe shop</span>
            <select name="supplier" defaultValue={bill.shop} className="min-h-11 w-56 rounded-control border border-line-strong bg-white px-2 text-sm" data-lathe-edit-shop>{[...new Set([bill.shop, ...shops.map((s) => s.name)])].map((n) => <option key={n} value={n}>{n}</option>)}</select>
          </label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Bill number</span><Input name="bill_number" defaultValue={bill.number} className="w-40" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Bill date</span><Input name="bill_date" type="date" defaultValue={bill.date} className="w-44" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Before VAT</span><Input name="before_vat" inputMode="decimal" defaultValue={bill.beforeVat.toFixed(2)} className="w-32" /></label>
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">VAT</span><Input name="vat" inputMode="decimal" defaultValue={bill.vat.toFixed(2)} className="w-28" /></label>
          <label className="flex min-w-64 flex-1 flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Why (kept in the history)</span><Input name="remark" required minLength={5} data-lathe-edit-remark /></label>
          <Button type="submit" size="md" disabled={eBusy} data-lathe-edit-save>{eBusy ? "Saving…" : "Save the correction"}</Button>
        </form>
      ) : null}
      <Answer s={eState} />
      {open === "void" && !vState?.message ? (
        <form action={vAction} className="flex flex-wrap items-end gap-2 rounded-control border border-red-bar bg-white p-3" data-lathe-void-form>
          <label className="flex min-w-64 flex-1 flex-col gap-1"><span className="text-xs font-semibold uppercase text-muted">Why void it?</span><Input name="reason" required minLength={5} data-lathe-void-reason /></label>
          <Button type="submit" size="md" tone="danger" disabled={vBusy} data-lathe-void-save>{vBusy ? "Sending…" : editable || isOwner ? "Void it" : "Ask the owner to void it"}</Button>
          <span className="w-full text-xs text-muted">Nothing is deleted: the bill stays in the list marked VOID; its tickets are open again.</span>
        </form>
      ) : null}
      <Answer s={vState} />
      {open === "attach" ? (
        <div className="rounded-control border border-dashed border-line-strong p-3" data-lathe-attach>
          <JobFileUpload jobId="nocar" kind="supplier_invoice" refId={bill.id} files={bill.files} accept="pdf" label="Attach invoice (photo or PDF)" caption={`Lathe bill ${bill.number}`} />
        </div>
      ) : null}
      {bill.history.length ? (
        <details className="text-xs text-muted" data-lathe-history>
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">History ({bill.history.length})</summary>
          <ul className="flex flex-col gap-1">{bill.history.map((h, i) => <li key={i}>{new Date(h.at).toLocaleString("en-GB", { timeZone: "Asia/Dubai" })} · {h.by}: {h.remark} — {h.changes.map((c) => `${c.field}: ${String(c.old)} → ${String(c.new)}`).join("; ")}</li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}

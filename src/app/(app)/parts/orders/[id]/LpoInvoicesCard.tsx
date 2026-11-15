"use client";

import { useState } from "react";
import { ActionForm } from "@/components/forms";
import { JobFileUpload } from "@/components/JobFileUpload";
import { Badge, Button, Card, Input, SectionLabel } from "@/components/ui";
import { newUuid } from "@/lib/uuid";
import { addLpoInvoiceAction, checkLpoInvoiceAction, editLpoInvoiceAction, moveInvoiceLineAction, notOnFirstAction, splitLpoInvoiceAction } from "@/app/(app)/parts/lpo-invoice-actions";

export type LpoInvCoverage = { lineId: string; description: string; qty: number; onFirst: number; onOthers: number; waiting: number };
export type LpoInvExtra = { id: string; number: string; date: string; amount: number; vat: number | null; gross: number; lines: { lineId: string; description: string; qty: number }[]; checked: boolean; paid: boolean; query: string | null; inZoho: boolean };

const aed = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyText = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * ONE LPO, SEVERAL SUPPLIER INVOICES (10 November 2026, Section 3): "2 invoices · 1 line still waiting for an invoice",
 * each invoice with the lines it covers, each line still waiting marked, and for accounts: Add another invoice, Split
 * this invoice, Check and Edit. Every answer shows inside this card.
 */
export function LpoInvoicesCard({ poId, jobId, canPay, ready, summary, coverage, first, extras, paid, today, check = null, prices = {} }: { poId: string; jobId: string | null; canPay: boolean; ready: boolean; summary: string; coverage: LpoInvCoverage[]; first: { number: string | null; amount: number | null; vat: number | null }; extras: LpoInvExtra[]; paid: boolean; today: string; /** 15 November 2026: "Invoices total AED … of the LPO's AED …" and the warnings (a part on two invoices or none). */ check?: { words: string; warnings: string[] } | null; /** Each line's price before VAT (invoice price, else the LPO price): the value that moves with a part. */ prices?: Record<string, number> }) {
  const waiting = coverage.filter((c) => c.waiting > 0.0005);
  const onFirst = coverage.filter((c) => c.onFirst > 0.0005);
  return (
    <Card className="flex flex-col gap-3" id="invoices" data-lpo-invoices>
      <SectionLabel>Supplier invoices on this LPO</SectionLabel>
      <p className={`text-sm font-bold ${waiting.length ? "text-amber-text" : ""}`} data-lpo-invoices-summary>{summary}</p>
      {check ? (
        <div className={`flex flex-col gap-1 rounded-control border px-3 py-2 text-sm ${check.warnings.length ? "border-amber-bar bg-amber-soft" : "border-line"}`} data-lpo-invoices-check={check.warnings.length ? "warn" : "ok"}>
          <span className="font-bold" data-lpo-invoices-total>{check.words}{check.warnings.length ? "" : " ✓"}</span>
          {check.warnings.map((w, i) => <span key={i} className="font-semibold" data-lpo-invoices-warning>{w}</span>)}
        </div>
      ) : null}
      {!ready ? <p className="text-xs text-muted" data-lpo-invoices-dormant>Several invoices on one LPO switch on once the database change is applied (waiting for the owner&apos;s apply).</p> : null}
      <ul className="flex flex-col divide-y divide-line text-sm" data-lpo-invoice-lines>
        {coverage.map((c) => (
          <li key={c.lineId} className="flex flex-wrap items-center justify-between gap-2 py-2" data-lpo-invoice-line={c.lineId}>
            <span className="font-semibold uppercase">{c.description} <span className="text-muted normal-case">× {qtyText(c.qty)}</span></span>
            <span className="flex flex-wrap gap-1">
              {c.onFirst > 0.0005 && first.number ? <Badge tone="neutral">{first.number}{c.onFirst < c.qty ? ` × ${qtyText(c.onFirst)}` : ""}</Badge> : null}
              {extras.filter((e) => e.lines.some((l) => l.lineId === c.lineId)).map((e) => <Badge key={e.id} tone="neutral">{e.number}{(() => { const q = e.lines.find((l) => l.lineId === c.lineId)?.qty ?? 0; return q < c.qty ? ` × ${qtyText(q)}` : ""; })()}</Badge>)}
              {c.waiting > 0.0005 ? <Badge tone="amber" data-line-waiting>Waiting for invoice{c.waiting < c.qty ? ` × ${qtyText(c.waiting)}` : ""}</Badge> : null}
            </span>
            {canPay && ready && first.number && extras.length ? <MoveLine poId={poId} c={c} first={first} firstPaid={paid} extras={extras} price={prices[c.lineId] ?? 0} /> : null}
          </li>
        ))}
      </ul>
      {extras.length ? (
        <div className="flex flex-col gap-2" data-lpo-extra-invoices>
          {extras.map((e) => <ExtraInvoice key={e.id} e={e} canPay={canPay} coverage={coverage} />)}
        </div>
      ) : null}
      {canPay && ready && first.number && waiting.length ? <AddInvoice poId={poId} jobId={jobId} waiting={waiting} today={today} /> : null}
      {canPay && ready && first.number && onFirst.length > 1 ? <NotOnFirst poId={poId} first={first} lines={onFirst} /> : null}
      {canPay && ready && first.number && !paid && onFirst.length ? <SplitInvoice poId={poId} jobId={jobId} first={first} lines={onFirst} today={today} /> : null}
    </Card>
  );
}

function LinePicks({ lines, max, prefix = "" }: { lines: { lineId: string; description: string }[]; max: (lineId: string) => number; prefix?: string }) {
  return (
    <div className="flex flex-col gap-1" data-line-picks>
      {lines.map((l) => (
        <label key={l.lineId} className="flex min-h-11 flex-wrap items-center gap-2 rounded-control border border-line px-3" data-pick-line={`${prefix}${l.lineId}`}>
          <input type="checkbox" name={`line__${l.lineId}`} className="h-5 w-5 accent-ink" />
          <span className="flex-1 text-sm font-semibold uppercase">{l.description}</span>
          <span className="text-xs text-muted">qty</span>
          <input name={`qty__${l.lineId}`} defaultValue={qtyText(max(l.lineId))} inputMode="decimal" className="h-9 w-20 rounded-control border border-line-strong px-2 text-sm" aria-label={`Quantity of ${l.description}`} />
        </label>
      ))}
    </div>
  );
}

function InvoiceFields({ prefix = "", today, defaults = {} }: { prefix?: string; today: string; defaults?: { number?: string; date?: string; amount?: string; vat?: string } }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Invoice number</span><Input name={`${prefix}number`} required defaultValue={defaults.number ?? ""} spell={false} data-inv-number /></label>
      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Invoice date</span><Input name={`${prefix}date`} type="date" required max={today} defaultValue={defaults.date ?? ""} data-inv-date /></label>
      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Before VAT (as printed)</span><Input name={`${prefix}amount`} inputMode="decimal" required defaultValue={defaults.amount ?? ""} spell={false} data-inv-amount /></label>
      <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">VAT (as printed; empty = 5%)</span><Input name={`${prefix}vat`} inputMode="decimal" defaultValue={defaults.vat ?? ""} spell={false} data-inv-vat /></label>
    </div>
  );
}

function AddInvoice({ poId, jobId, waiting, today }: { poId: string; jobId: string | null; waiting: LpoInvCoverage[]; today: string }) {
  const [id] = useState(() => newUuid());
  return (
    <details className="rounded-control border border-line p-3" data-add-invoice>
      <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold">+ Add another invoice</summary>
      <ActionForm action={addLpoInvoiceAction.bind(null, poId)} className="flex flex-col gap-3 pt-2">
        {() => (
          <>
            <input type="hidden" name="invoice_id" value={id} />
            <p className="text-xs text-muted">Tick the lines this invoice covers (and how many, if it is part of a line).</p>
            <LinePicks lines={waiting} max={(lid) => waiting.find((w) => w.lineId === lid)?.waiting ?? 0} />
            <InvoiceFields today={today} />
            {jobId ? <JobFileUpload jobId={jobId} kind="supplier_invoice" refId={id} files={[]} accept="pdf" label="Scan / attach the invoice" compact removable /> : null}
            <Button type="submit" size="md" data-add-invoice-save>Save the invoice</Button>
          </>
        )}
      </ActionForm>
    </details>
  );
}

function SplitInvoice({ poId, jobId, first, lines, today }: { poId: string; jobId: string | null; first: { number: string | null; amount: number | null; vat: number | null }; lines: LpoInvCoverage[]; today: string }) {
  const [id] = useState(() => newUuid());
  return (
    <details className="rounded-control border border-line p-3" data-split-invoice>
      <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold">Split this invoice ({first.number})</summary>
      <ActionForm action={splitLpoInvoiceAction.bind(null, poId)} className="flex flex-col gap-3 pt-2">
        {() => (
          <>
            <input type="hidden" name="invoice_id" value={id} />
            <p className="text-xs text-muted">Tick the lines that came on the OTHER invoice; they move to its own number. Then type both invoices&apos; amounts as printed.</p>
            <LinePicks lines={lines} max={(lid) => lines.find((w) => w.lineId === lid)?.onFirst ?? 0} prefix="split:" />
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">The other invoice</p>
            <InvoiceFields today={today} />
            {jobId ? <JobFileUpload jobId={jobId} kind="supplier_invoice" refId={id} files={[]} accept="pdf" label="Scan / attach the other invoice" compact removable /> : null}
            <p className="text-xs font-bold uppercase tracking-[0.08em] text-muted">What stays on {first.number}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Before VAT (as printed)</span><Input name="first_amount" inputMode="decimal" required defaultValue={first.amount !== null ? first.amount.toFixed(2) : ""} spell={false} data-split-first-amount /></label>
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">VAT (as printed; empty = 5%)</span><Input name="first_vat" inputMode="decimal" defaultValue={first.vat !== null ? first.vat.toFixed(2) : ""} spell={false} data-split-first-vat /></label>
            </div>
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Why (kept with the invoice)</span><Input name="remark" defaultValue="Two separate supplier invoices" data-split-remark /></label>
            <Button type="submit" size="md" data-split-save>Split into two invoices</Button>
          </>
        )}
      </ActionForm>
    </details>
  );
}

function ExtraInvoice({ e, canPay, coverage }: { e: LpoInvExtra; canPay: boolean; coverage: LpoInvCoverage[] }) {
  // 15 November 2026: editing an invoice shows only ITS OWN lines (a part moves with "Move to another invoice").
  const lines = e.lines.map((l) => ({ lineId: l.lineId, description: l.description }));
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line p-3" data-lpo-extra-invoice={e.number}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold">{e.number} · {e.date} · AED {aed(e.amount)} + VAT {e.vat === null ? "5%" : aed(e.vat)} = AED {aed(e.gross)}</span>
        <span className="flex flex-wrap gap-1">
          {e.paid ? <Badge tone="green">Paid</Badge> : null}
          {e.inZoho ? <Badge tone="neutral">In Zoho</Badge> : null}
          {e.checked ? <Badge tone="green" data-extra-checked>Checked</Badge> : <Badge tone="amber">To check</Badge>}
        </span>
      </div>
      <p className="text-xs text-muted">{e.lines.map((l) => `${l.description.toUpperCase()} × ${qtyText(l.qty)}`).join(" · ")}</p>
      {e.query ? <p className="text-xs font-semibold text-amber-text">Query: {e.query}</p> : null}
      {canPay && !e.checked ? (
        <ActionForm action={checkLpoInvoiceAction.bind(null, e.id)} className="flex flex-col gap-2">
          {() => <div><Button type="submit" size="md" data-extra-check>Mark checked</Button></div>}
        </ActionForm>
      ) : null}
      {canPay && !e.paid ? (
        <details data-extra-edit>
          <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold underline underline-offset-4">Edit this invoice</summary>
          <ActionForm action={editLpoInvoiceAction.bind(null, e.id)} className="flex flex-col gap-3 pt-2">
            {() => (
              <>
                <div className="flex flex-col gap-1">
                  {lines.map((l) => {
                    const mine = e.lines.find((x) => x.lineId === l.lineId);
                    return (
                      <label key={l.lineId} className="flex min-h-11 flex-wrap items-center gap-2 rounded-control border border-line px-3">
                        <input type="checkbox" name={`line__${l.lineId}`} defaultChecked={!!mine} className="h-5 w-5 accent-ink" />
                        <span className="flex-1 text-sm font-semibold uppercase">{l.description}</span>
                        <input name={`qty__${l.lineId}`} defaultValue={qtyText(mine?.qty ?? coverage.find((c) => c.lineId === l.lineId)?.waiting ?? 0)} inputMode="decimal" className="h-9 w-20 rounded-control border border-line-strong px-2 text-sm" aria-label={`Quantity of ${l.description}`} />
                      </label>
                    );
                  })}
                </div>
                <InvoiceFields today="9999-12-31" defaults={{ number: e.number, date: e.date, amount: e.amount.toFixed(2), vat: e.vat === null ? "" : e.vat.toFixed(2) }} />
                <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Why is it changed? (compulsory)</span><Input name="remark" required minLength={5} data-extra-edit-remark /></label>
                <Button type="submit" size="md" data-extra-edit-save>Save the change</Button>
              </>
            )}
          </ActionForm>
        </details>
      ) : null}
    </div>
  );
}

function NotOnFirst({ poId, first, lines }: { poId: string; first: { number: string | null }; lines: LpoInvCoverage[] }) {
  return (
    <details className="rounded-control border border-line p-3" data-not-on-first>
      <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold">Some lines are not on {first.number} yet</summary>
      <ActionForm action={notOnFirstAction.bind(null, poId)} className="flex flex-col gap-3 pt-2">
        {() => (
          <>
            <p className="text-xs text-muted">Tick what the supplier will send on another invoice: those lines show &quot;Waiting for invoice&quot; until it comes.</p>
            <LinePicks lines={lines} max={(lid) => lines.find((w) => w.lineId === lid)?.onFirst ?? 0} prefix="off:" />
            <Button type="submit" size="md" tone="secondary" data-not-on-first-save>Not on this invoice</Button>
          </>
        )}
      </ActionForm>
    </details>
  );
}

/** "Move to another invoice" on one line (15 November 2026): a quantity of the part leaves one invoice for another, with its amount. */
function MoveLine({ poId, c, first, firstPaid, extras, price }: { poId: string; c: LpoInvCoverage; first: { number: string | null }; firstPaid: boolean; extras: LpoInvExtra[]; price: number }) {
  const on = [
    ...(c.onFirst > 0.0005 ? [{ id: "first", number: first.number ?? "", qty: c.onFirst, paid: firstPaid }] : []),
    ...extras.filter((e) => e.lines.some((l) => l.lineId === c.lineId)).map((e) => ({ id: e.id, number: e.number, qty: e.lines.find((l) => l.lineId === c.lineId)?.qty ?? 0, paid: e.paid })),
  ].filter((x) => !x.paid);
  const [from, setFrom] = useState(on[0]?.id ?? "");
  const [qty, setQty] = useState(qtyText(on[0]?.qty ?? 0));
  if (!on.length) return null;
  const all = [{ id: "first", number: first.number ?? "", paid: firstPaid }, ...extras.map((e) => ({ id: e.id, number: e.number, paid: e.paid }))];
  const targets = all.filter((x) => x.id !== from && !x.paid);
  const value = Math.round((Number(qty.replace(/,/g, ".")) || 0) * price * 100) / 100;
  return (
    <details className="w-full" data-move-line={c.lineId}>
      <summary className="cursor-pointer min-h-11 inline-flex items-center text-sm font-bold underline underline-offset-4" data-move-open>Move to another invoice</summary>
      <ActionForm action={moveInvoiceLineAction.bind(null, poId, c.lineId)} className="mt-2 flex flex-col gap-2 rounded-control bg-surface p-3">
        {() => (
          <>
            {on.length > 1 ? (
              <label className="flex flex-col gap-1 text-sm"><span className="font-semibold">From invoice</span>
                <select name="from" value={from} onChange={(e) => { setFrom(e.target.value); setQty(qtyText(on.find((x) => x.id === e.target.value)?.qty ?? 0)); }} className="h-11 rounded-control border border-line-strong px-2" data-move-from>
                  {on.map((x) => <option key={x.id} value={x.id}>{x.number} (× {qtyText(x.qty)})</option>)}
                </select>
              </label>
            ) : <><input type="hidden" name="from" value={from} /><span className="text-sm">From invoice <strong>{on[0].number}</strong> (× {qtyText(on[0].qty)})</span></>}
            <label className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold">How many</span>
              <input name="qty" value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" className="h-11 w-24 rounded-control border border-line-strong px-2" data-move-qty />
              <span className="text-muted">AED {aed(value)} before VAT moves with it</span>
            </label>
            <fieldset className="flex flex-col gap-1 text-sm"><legend className="font-semibold">To invoice</legend>
              {targets.map((t) => (
                <label key={t.id} className="flex min-h-11 items-center gap-2"><input type="radio" name="to" value={t.id} required className="h-5 w-5 accent-ink" data-move-to={t.number} /> {t.number}</label>
              ))}
              <label className="flex min-h-11 items-center gap-2"><input type="radio" name="to" value="new" required className="h-5 w-5 accent-ink" data-move-to-new /> A new invoice number (use &quot;Split this invoice&quot; below)</label>
            </fieldset>
            <Input name="remark" placeholder="Why (optional), e.g. the supplier invoiced the spark plugs separately" data-move-remark />
            <div><Button type="submit" size="md" data-move-save>Move</Button></div>
          </>
        )}
      </ActionForm>
    </details>
  );
}

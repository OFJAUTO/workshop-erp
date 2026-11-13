import { Words } from "@/components/Words";
import { SupplierAmount } from "@/components/SupplierAmount";
import { advanceWords } from "@/lib/supplier-payment-rules";
import { moneyFrom } from "@/lib/supplier-money";
import Link from "next/link";
import { Fragment } from "react";
import { Badge, Card } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { LPO_STEP_WORDS, PROBLEM_WORDS, aedWords, type LpoRow, type PartLineRow, type PartsProblem, type ReturnRow, type SupplierBalance } from "@/lib/parts-accounts-rules";
import { STATUS_WORDS, invWords, unpaidShares } from "@/lib/supplier-invoice-rows";
import { NO_TRN_WORDS } from "@/lib/supplier-rules";

/*
 * The tab bodies of Parts accounts (3 November 2026, section 12). Cards, never a wide table, so every screen from a
 * phone to a PC shows the whole row without sliding sideways; each card opens where its action lives (job card, LPO,
 * supplier invoice, Returns and leftovers). No action here changes money: those stay on their own pages.
 */

const money = (n: number | null | undefined) => (n === null || n === undefined ? "–" : aedWords(n));
const LINK = "inline-flex min-h-11 items-center font-bold underline underline-offset-4";
const ago = (days: number | null) => (days === null ? "" : days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`);

/** A shown list is cut at this many cards (the export always has every row). */
export const SHOWN_MAX = 300;

export function Shown({ total, shown }: { total: number; shown: number }) {
  if (total <= shown) return null;
  return <p className="text-sm text-muted" data-pa-cut>Showing the first {shown} of {total}. Narrow it with the search, the supplier or the dates, or export everything to Excel.</p>;
}

function Dot({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${on ? "text-green-text" : "text-muted"}`} data-pa-dot={label} data-on={on ? "1" : "0"}>
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${on ? "bg-green" : "border border-line-strong bg-white"}`} aria-hidden />
      {label}
    </span>
  );
}

const lineTone = (r: PartLineRow): "neutral" | "green" | "amber" | "red" | "ink" | "outline" => {
  if (r.ending === "refused" || r.ending === "removed" || r.ending === "scrap" || r.ending === "cancelled") return "neutral";
  if (r.ending) return r.ending === "goodwill" || r.ending === "returned" || r.ending === "stock" ? "outline" : "amber";
  // Late first: a part already on the customer's invoice but still with the supplier is not "all good".
  if (r.late) return "red";
  if (r.step === "invoiced") return r.dots.received ? "green" : "amber";
  if (r.step === "to_price" || r.step === "lpo_waiting" || r.step === "approved") return "amber";
  return "ink";
};

export function LinesTab({ rows }: { rows: PartLineRow[] }) {
  const shown = rows.slice(0, SHOWN_MAX);
  return (
    <section className="flex flex-col gap-2" data-pa-list="lines">
      {rows.length === 0 ? <Card><p className="text-sm text-muted">No part lines match.</p></Card> : null}
      {shown.map((r) => (
        <Card key={r.key} className={`flex flex-col gap-2 !p-4 ${r.late ? "!border-red-bar" : ""}`} data-pa-row={r.key} data-pa-state={r.state}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 font-extrabold uppercase break-words">{r.part}</span>
            {r.partNumber ? <span className="whitespace-nowrap text-xs text-muted">{r.partNumber}</span> : null}
            <span className="whitespace-nowrap text-sm font-semibold" data-pa-qty>× {r.qtyWords}</span>
            <Badge tone={lineTone(r)} data-pa-status={r.state}>{r.stateWords}</Badge>
            {r.late ? <Badge tone="red">Late: expected {formatDate(r.expectedDate)}</Badge> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {r.jobId ? <Link href={`/jobs/${r.jobId}`} className={`${LINK} whitespace-nowrap`}>{[r.jobNumber, r.plate].filter(Boolean).join(" · ")}</Link> : <span className="text-muted">No job</span>}
            {r.car ? <span className="text-muted">{r.car}</span> : null}
            <span className="font-semibold">{r.supplier || "No supplier"}</span>
            {r.poId ? <Link href={`/parts/orders/${r.poId}`} className={`${LINK} whitespace-nowrap`}>{r.poNumber}</Link> : null}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Dot on={r.dots.ordered} label="Ordered" />
            <Dot on={r.dots.received} label="Received" />
            <Dot on={r.dots.fitted} label="Fitted" />
            <Dot on={r.dots.invoiced} label="Invoiced" />
          </div>
          <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-3" data-pa-money>
            <span data-pa-cost={r.cost.toFixed(2)}>Cost <b className="whitespace-nowrap">{money(r.cost)}</b> <Words className="text-xs text-muted" text={`${r.unitCost !== null && r.qty !== 1 ? `${money(r.unitCost)} each · ` : ""}${r.costFrom}`} /></span>
            <span data-pa-selling={r.selling === null ? "" : r.selling.toFixed(2)}>Selling <b className="whitespace-nowrap">{money(r.selling)}</b> <span className="text-xs text-muted">{r.sellingDoc ? <>{r.sellingFrom === "quotation" ? "approved " : ""}<span className="whitespace-nowrap">{r.sellingDoc}</span></> : "not on a quotation"}{r.notCharged ? ` · ${r.notCharged}` : ""}</span></span>
            <span className={r.margin !== null && r.margin < 0 ? "font-bold text-red" : ""} data-pa-margin={r.margin === null ? "" : r.margin.toFixed(2)}>Margin <b className="whitespace-nowrap">{money(r.margin)}</b>{r.marginPct !== null ? <span className="text-xs text-muted"> {r.marginPct}%</span> : null}</span>
          </div>
        </Card>
      ))}
      <Shown total={rows.length} shown={shown.length} />
    </section>
  );
}

const lpoTone = (r: LpoRow): "neutral" | "green" | "amber" | "red" | "ink" | "outline" => (r.step === "paid" ? "green" : r.step === "cancelled" ? "neutral" : r.step === "waiting_approval" || r.step === "approved" ? "amber" : r.step === "received" ? "red" : r.step === "invoiced" ? "outline" : "ink");
const zohoWords = (s: string | null) => (s === "synced" ? "In Zoho ✓" : s === "failed" ? "Zoho: failed" : s === "pending" ? "Zoho: waiting" : null);

export function LposTab({ rows, redDays }: { rows: LpoRow[]; redDays: number }) {
  const shown = rows.slice(0, SHOWN_MAX);
  return (
    <section className="flex flex-col gap-2" data-pa-list="lpos">
      {rows.length === 0 ? <Card><p className="text-sm text-muted">No LPOs match.</p></Card> : null}
      {shown.map((r) => {
        const red = r.lateLines > 0 || (r.invoiceMissing && (r.invoiceMissingDays ?? 0) >= redDays) || !!r.invoice?.duplicateOf;
        const bill = zohoWords(r.zohoBill);
        const pay = zohoWords(r.zohoPayment);
        return (
          <Card key={r.key} className={`flex flex-col gap-2 !p-4 ${red ? "!border-red-bar" : ""}`} data-pa-row={r.key} data-pa-state={r.step} data-pa-lpo={r.number}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href={`/parts/orders/${r.id}`} className={`${LINK} whitespace-nowrap font-extrabold`}>{r.number}</Link>
              {r.kind === "stock" ? <Badge tone="ink">Stock order</Badge> : r.kind === "main" ? <Badge tone="outline">Main LPO</Badge> : null}
              <span className="font-semibold uppercase">{r.supplier}</span>
              <Badge tone={lpoTone(r)} data-pa-status={r.step}>{r.step === "received" && r.invoiceMissingDays !== null ? `${LPO_STEP_WORDS.received} · ${r.invoiceMissingDays} day${r.invoiceMissingDays === 1 ? "" : "s"}` : r.stepWords}</Badge>
              {r.lateLines ? <Badge tone="red">{r.lateLines} line{r.lateLines === 1 ? "" : "s"} late</Badge> : null}
              <span className="ml-auto" data-pa-amount={r.amount.toFixed(2)}><SupplierAmount money={moneyFrom(r.amount, r.vat, r.vatCharged)} cancelled={r.cancelled} size="sm" /></span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              {r.jobId ? <Link href={`/jobs/${r.jobId}`} className={`${LINK} whitespace-nowrap`}>{[r.jobNumber, r.plate].filter(Boolean).join(" · ")}</Link> : <span className="text-muted">For the shelf</span>}
              {r.car ? <span className="text-muted">{r.car}</span> : null}
              <span className="text-muted">{r.parts} line{r.parts === 1 ? "" : "s"}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span>Raised {formatDateTime(r.createdAt)}</span>
              {r.approvedAt ? <span data-pa-approved>Approved {formatDateTime(r.approvedAt)}{r.approvedBy ? ` by ${r.approvedBy}` : ""}</span> : null}
              {r.orderedAt ? <span>Ordered {formatDateTime(r.orderedAt)}{r.expected && r.step === "ordered" ? `, expected ${formatDate(r.expected)}` : ""}</span> : null}
              {r.receivedAt ? <span>Received {formatDateTime(r.receivedAt)}</span> : null}
              {r.paidAt ? <span className="font-semibold text-green-text" data-pa-paid>Paid {formatDateTime(r.paidAt)}{r.paidMethod ? ` · ${r.paidMethod}` : ""}{r.paidReference ? ` · ref ${r.paidReference}` : ""}</span> : null}
            </div>
            {r.invoice || bill || pay ? (
              <div className="flex flex-wrap items-center gap-2" data-pa-invoice>
                {r.invoice ? <Link href={`/parts-accounts?tab=invoices&open=${encodeURIComponent(r.invoice.key)}`} className={`${LINK} whitespace-nowrap text-sm`}>{invWords(r.invoice.number)}</Link> : null}
                {r.invoice ? <Badge tone="outline">{STATUS_WORDS[r.invoice.status as keyof typeof STATUS_WORDS] ?? r.invoice.statusWords}</Badge> : null}
                {r.invoice?.match.map((m, i) => <span key={m} className={`rounded-full px-2 py-0.5 text-xs font-bold ${m === "matches" ? "bg-green-soft text-green-text" : "border border-amber-bar bg-amber-soft text-amber-text"}`} data-pa-match={m}>{r.invoice!.matchWords[i]}</span>)}
                {r.invoice?.duplicateOf ? <span className="rounded-full border border-red-bar bg-white px-2 py-0.5 text-xs font-bold text-red">Possible duplicate of {r.invoice.duplicateOf}</span> : null}
                {bill ? <span className={`text-xs font-bold ${r.zohoBill === "failed" ? "text-red" : "text-muted"}`}>Bill: {bill}</span> : null}
                {pay ? <span className={`text-xs font-bold ${r.zohoPayment === "failed" ? "text-red" : "text-muted"}`}>Payment: {pay}</span> : null}
              </div>
            ) : null}
          </Card>
        );
      })}
      <Shown total={rows.length} shown={shown.length} />
    </section>
  );
}

/** The LPOs of a supplier invoice still to pay, each one a link to its own payment box (paid LPO by LPO). */
function PayLinks({ r }: { r: SupplierBalance["invoices"][number] }) {
  const toPay = unpaidShares(r);
  if (!toPay.length) return null;
  const named = toPay.length > 1 || r.shares.length > 1;
  return (
    <span className="ml-auto flex flex-wrap gap-x-3">
      {toPay.map((s) => <Link key={s.poId} href={`/parts/orders/${s.poId}#paid`} className={`${LINK} whitespace-nowrap`} data-pa-pay={s.poId}>{named ? `Pay ${s.poNumber}` : "Pay on the LPO"}</Link>)}
    </span>
  );
}

export function PaymentsTab({ rows, canPay, advances = {} }: { rows: SupplierBalance[]; canPay: boolean; /** "Advance with Gargash AED X" by supplier id or upper-case name (6 November 2026). */ advances?: Record<string, number> }) {
  return (
    <section className="flex flex-col gap-2" data-pa-list="payments">
      {rows.length === 0 ? <Card><p className="text-sm text-muted">No supplier invoices match.</p></Card> : null}
      {rows.map((b) => (
        <Card key={b.key} className={`flex flex-col gap-2 !p-4 ${b.unpaid > 0 ? "!border-ink" : ""}`} data-pa-row={b.key} data-pa-supplier={b.supplier} data-pa-state={b.unpaid > 0 ? "unpaid" : "paid"}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-extrabold uppercase">{b.supplier}</span>
            {b.trn ? <span className="whitespace-nowrap text-xs text-muted">TRN {b.trn}</span> : null}
            {b.needsTrn ? <Badge tone="red" data-pa-no-trn>{NO_TRN_WORDS}</Badge> : !b.vatRegistered ? <Badge tone="neutral">Not VAT registered</Badge> : null}
            {b.proofMissingCount ? <Badge tone="red" data-pa-proof-missing>{b.proofMissingCount} paid without proof</Badge> : null}
            {b.terms ? <span className="text-xs text-muted">Terms: {b.terms}</span> : null}
            {(advances[b.supplierId ?? ""] ?? advances[b.supplier.toUpperCase()]) ? <Badge tone="green" data-pa-advance>{advanceWords(b.supplier, advances[b.supplierId ?? ""] ?? advances[b.supplier.toUpperCase()])}</Badge> : null}
            <span className={`ml-auto whitespace-nowrap text-sm font-extrabold ${b.unpaid > 0 ? "" : "text-green-text"}`} data-pa-unpaid={b.unpaid.toFixed(2)}>{b.unpaid > 0 ? `Unpaid ${money(b.unpaid)} (${b.unpaidCount})` : "Nothing unpaid ✓"}</span>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <span>Invoiced <b className="whitespace-nowrap">{money(b.invoiced)}</b> <span className="text-xs text-muted">({b.invoicedCount})</span></span>
            <span>Paid <b className="whitespace-nowrap">{money(b.paid)}</b> <span className="text-xs text-muted">({b.paidCount})</span></span>
            <span>{b.oldestUnpaid ? <>Oldest unpaid <b className="whitespace-nowrap">{formatDate(b.oldestUnpaid)}</b></> : <span className="text-muted">No unpaid invoice</span>}</span>
            <span>{b.toFollowCount ? <>Invoice to follow <b className="whitespace-nowrap">{money(b.toFollow)}</b> <span className="text-xs text-muted">({b.toFollowCount})</span></> : b.creditsDue ? <>Credits due <b className="whitespace-nowrap">{money(b.creditsDue)}</b></> : <span className="text-muted">Nothing to follow</span>}</span>
          </div>
          {b.toFollowCount && b.creditsDue ? <p className="text-sm">Credits due from returns <b>{money(b.creditsDue)}</b></p> : null}
          <details className="group">
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-sm font-bold underline underline-offset-4 [&::-webkit-details-marker]:hidden" data-pa-invoices-open>
              <span className="group-open:hidden">See the {b.invoices.length} invoice{b.invoices.length === 1 ? "" : "s"} ▾</span>
              <span className="hidden group-open:inline">Hide the invoices ▴</span>
            </summary>
            <ul className="mt-1 flex flex-col divide-y divide-line text-sm">
              {b.invoices.map((r) => (
                <li key={r.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2" data-pa-invoice-row={r.key}>
                  <Link href={`/parts-accounts?tab=invoices&open=${encodeURIComponent(r.key)}`} className={`${LINK} whitespace-nowrap`}>{invWords(r.number)}</Link>
                  {r.date ? <span className="text-muted">{formatDate(r.date)}</span> : null}
                  <span className="whitespace-nowrap font-semibold">{money(r.total)}</span>
                  <span className="text-xs text-muted">{r.shares.map((s, i) => <Fragment key={s.poId}>{i ? ", " : ""}<span className="whitespace-nowrap">{s.poNumber}</span></Fragment>)}</span>
                  {r.status === "waiting" ? <Badge tone="amber">Invoice to follow</Badge> : r.paid ? <Badge tone="green">Paid {r.paidAt ? formatDate(r.paidAt) : ""}{r.paidMethod ? ` · ${r.paidMethod}` : ""}{r.paidReference ? ` · ${r.paidReference}` : ""}</Badge> : r.partlyPaid ? <Badge tone="amber" data-pa-partly-paid>Partly paid · {money(r.unpaidAmount)} to pay</Badge> : <Badge tone="ink">Unpaid · {STATUS_WORDS[r.status]}</Badge>}
                  {r.proofMissing ? <Badge tone="red" data-pa-invoice-proof-missing>Proof missing</Badge> : null}
                  {/* Paid LPO by LPO: one link per LPO still to pay (a split invoice paid on one LPO points at the other). */}
                  {canPay ? <PayLinks r={r} /> : null}
                </li>
              ))}
            </ul>
          </details>
        </Card>
      ))}
    </section>
  );
}

const returnTone = (r: ReturnRow): "neutral" | "green" | "amber" | "red" => (r.state === "credit_on_file" ? "green" : r.overdue ? "red" : r.state === "waiting_credit" || r.state === "credit_due" ? "amber" : "neutral");

export function ReturnsTab({ rows, waitDays, canDecide }: { rows: ReturnRow[]; waitDays: number; canDecide: boolean }) {
  return (
    <section className="flex flex-col gap-2" data-pa-list="returns">
      <p className="text-xs text-muted">A part returned to the supplier waits for their credit note (the number typed on Returns and leftovers, or its scan); it turns red after {waitDays} days. The credit expected is the supplier&apos;s credit note amount when it was typed, else the supplier invoice price, else the LPO price, with VAT when the supplier is VAT registered. A part cancelled with the supplier owes nothing, unless its LPO was already paid. A part never bought (its LPO still waiting for approval) owes no credit and is not listed.</p>
      {rows.length === 0 ? <Card><p className="text-sm text-muted">No returned parts match.</p></Card> : null}
      {rows.map((r) => (
        <Card key={r.key} className={`flex flex-col gap-2 !p-4 ${r.overdue ? "!border-red-bar" : ""}`} data-pa-row={r.key} data-pa-state={r.state}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 font-extrabold uppercase break-words">{r.part}</span>
            {r.partNumber ? <span className="whitespace-nowrap text-xs text-muted">{r.partNumber}</span> : null}
            <span className="whitespace-nowrap text-sm font-semibold">× {r.qtyWords}</span>
            <Badge tone={returnTone(r)} data-pa-status={r.state}>{r.stateWords}{r.waitingDays !== null && r.state !== "credit_on_file" ? ` · ${ago(r.waitingDays)}` : ""}</Badge>
            <span className="ml-auto text-sm font-extrabold" data-pa-credit={r.creditWithVat.toFixed(2)}><span className="whitespace-nowrap">Credit {money(r.creditWithVat)}</span> <span className="whitespace-nowrap text-xs font-semibold text-muted">({money(r.credit)} before VAT)</span></span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {r.jobId ? <Link href={`/jobs/${r.jobId}`} className={`${LINK} whitespace-nowrap`}>{[r.jobNumber, r.plate].filter(Boolean).join(" · ")}</Link> : null}
            {r.car ? <span className="text-muted">{r.car}</span> : null}
            <span className="font-semibold">{r.supplier || "No supplier"}</span>
            {r.poId ? <Link href={`/parts/orders/${r.poId}`} className={`${LINK} whitespace-nowrap`}>{r.poNumber}</Link> : null}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            {r.returnedAt ? <span>{r.state === "credit_due" ? "Cancelled" : "Returned"} {formatDateTime(r.returnedAt)}</span> : null}
            {r.creditNote.number ? <span className="font-semibold text-ink">Credit note {r.creditNote.number}{r.creditNote.date ? ` · ${formatDate(r.creditNote.date)}` : ""}{r.creditNote.amount !== null ? ` · ${money(r.creditNote.amount)}` : ""}</span> : null}
            {r.creditNote.scan ? <span className="font-semibold text-green-text">Credit note scan on file ✓</span> : null}
            {r.note ? <span>Note: {r.note}</span> : null}
            {r.zoho ? <span className={r.zoho === "failed" ? "font-bold text-red" : ""}>Vendor credit: {zohoWords(r.zoho)}</span> : null}
          </div>
          {r.state === "no_ending" || r.state === "to_return" ? (
            canDecide ? <Link href="/parts/no-home" className={`${LINK} text-sm`}>Decide on Returns and leftovers</Link> : <span className="text-xs text-muted">Parts decide its ending on Returns and leftovers.</span>
          ) : r.state === "waiting_credit" && !r.creditNote.onFile ? (
            canDecide ? <Link href={`/parts/no-home#cn-${r.partId}`} className={`${LINK} text-sm`} data-pa-record-credit>Record the credit note on Returns and leftovers</Link> : <span className="text-xs text-muted">Parts record the credit note on Returns and leftovers.</span>
          ) : null}
        </Card>
      ))}
    </section>
  );
}

export function ProblemsTab({ rows }: { rows: PartsProblem[] }) {
  return (
    <section className="flex flex-col gap-2" data-pa-list="problems">
      {rows.length === 0 ? <Card><p className="text-sm font-semibold text-green-text" data-pa-no-problems>No problems ✓</p></Card> : null}
      {rows.map((p) => (
        <Card key={p.key} className={`flex flex-col gap-1.5 !p-4 ${p.severity === "red" ? "!border-red-bar" : "!border-amber-bar"}`} data-pa-row={p.key} data-pa-state={p.rule} data-pa-problem={p.rule} data-pa-severity={p.severity}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Badge tone={p.severity === "red" ? "red" : "amber"}>{PROBLEM_WORDS[p.rule]}</Badge>
            <span className="min-w-0 font-extrabold break-words">{p.title}</span>
            {p.amount !== null ? <span className="ml-auto whitespace-nowrap text-sm font-extrabold">{money(p.amount)}</span> : null}
          </div>
          <p className="text-sm" data-pa-detail>{p.detail}</p>
          <div className="flex flex-wrap items-center gap-x-3 text-sm">
            {p.since ? <span className="text-xs text-muted">Since {formatDate(p.since)}</span> : null}
            <Link href={p.href} className={LINK} data-pa-problem-open>Open</Link>
            {p.poId && !p.href.startsWith("/parts/orders/") ? <Link href={`/parts/orders/${p.poId}`} className={`${LINK} whitespace-nowrap`}>{p.poNumber}</Link> : null}
          </div>
        </Card>
      ))}
    </section>
  );
}

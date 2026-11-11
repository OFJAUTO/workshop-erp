import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { MoneyRow } from "@/components/MoneyRow";
import { Button, Card, Empty, Input, Notice, PageHeader, SectionLabel, LinkButton } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { dubaiDate } from "@/lib/jobs";
import { loadMoneyList, loadMoneyTiles, type MoneyRowData } from "@/lib/money-data";
import { MONEY_FILTERS, RECENT_PAID_HINT, chipCountOf, inFilter, rowMatches } from "@/lib/money-list";
import { can, type RoleId } from "@/lib/roles";
import { getSettings, bankFeeValuesOf, bankFeesOf } from "@/lib/settings";
import { MoneyTilesRow } from "@/app/(app)/dashboard/AccountsDashboard";
import { PaymentReportsCard } from "@/components/PaymentReportsCard";
import { paymentReportsReady } from "@/lib/schema-ready";
import { saveBankFeesAction } from "../accounts-posting/actions";
import { BankFeeSettings } from "../accounts-posting/BankFeeSettings";
import { feeRuleWords } from "@/lib/bank-fees";
import { RecordPaymentButton } from "@/components/RecordPaymentHost";
import { UnallocatedList } from "@/components/UnallocatedList";
import { unallocatedOf } from "@/lib/customer-money";

export const dynamic = "force-dynamic";

const FILTERS = MONEY_FILTERS;

/**
 * Invoices and payments: money only (3 November 2026: every job with money paid or owed). The tiles, the payments
 * advisors sent, then one row per job (and per customer credit, per pending charge) with "Paid so far · Balance", filtered
 * by the chips. The tiles and the chips come from the SAME list, so a tile is the sum of the list its link opens. Dates
 * show history (every job with a document issued between them); a search also finds older cars.
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; show?: string; from?: string; to?: string; q?: string }> }) {
  const staff = await requirePermission("viewInvoices");
  const role = staff.role_id as RoleId;
  const settings = await getSettings();
  const { message, error, show = "", from = "", to = "", q = "" } = await searchParams;
  const ranged = !!(from || to);
  const needle = q.trim();
  // THE list (now) feeds the tiles always; dates show history instead; a search adds older cars that match.
  const nowRows = await loadMoneyList(settings, { scope: "now" });
  const tiles = await loadMoneyTiles(nowRows);
  let all: MoneyRowData[] = nowRows;
  // What the search found on the server (by mobile, VIN, contact name, any document number too) stays: the page never
  // filters those rows again (review, 3 November 2026); the other rows must match the words themselves.
  const found = needle ? await loadMoneyList(settings, { scope: "search", q: needle }) : [];
  const foundKeys = new Set(found.map((r) => r.key));
  if (ranged) all = await loadMoneyList(settings, { scope: "range", from: from || "2020-01-01", to: to || dubaiDate() });
  else if (needle) all = [...nowRows, ...found.filter((r) => !nowRows.some((x) => x.key === r.key))];
  // 1 November 2026: money on customers' accounts, not allocated yet (with its age), and Record payment for anyone.
  const mayPay = can(role, "recordPayments") && !staff.viewingAs;
  const viewPay = can(role, "recordPayments") && !!staff.viewingAs;
  const reportsOn = await paymentReportsReady();
  const unallocated = await unallocatedOf();
  const searched = needle ? all.filter((r) => foundKeys.has(r.key) || rowMatches(r, needle)) : all;
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, chipCountOf(f.key, searched)]));
  const filtered = searched.filter((r) => inFilter(show, r));
  // What the list adds up to, under its heading (the same figures as the tile that opened it).
  const sumOf = (f: (r: MoneyRowData) => number) => filtered.reduce((a, r) => a + f(r), 0);
  const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const taxCount = sumOf((r) => r.taxToday.length);
  const listSum =
    show === "today" ? `${filtered.length} · ${aed(sumOf((r) => r.paidToday))} in ${plural(sumOf((r) => r.paidTodayCount), "payment", "payments")}`
    : show === "awaiting" || show === "part" ? `${filtered.length} · ${aed(sumOf((r) => r.balance ?? 0))} due`
    : show === "credit" || show === "advance" ? `${filtered.length} · ${aed(sumOf((r) => r.paid))}`
    // 3 November 2026: the rows, and the payments on them without a real auth code.
    : show === "auth_missing" ? `${filtered.length} · ${plural(sumOf((r) => r.authMissing.length), "payment", "payments")} without an auth code`
    // The tile counts tax invoices: the heading says the same number (and the cars when one has two).
    : show === "tax_today" ? `${plural(taxCount, "tax invoice", "tax invoices")}${taxCount !== filtered.length ? ` on ${plural(filtered.length, "car", "cars")}` : ""}`
    : `${filtered.length}`;
  const keep = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ show, from, to, q, ...next })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/invoices?${s}` : "/invoices";
  };

  return (
    <>
      {/* No "quotations": an approval or a decline always writes the job too, and the editor's heartbeat would re-render
          this page every minute while anyone edits a quotation (review, 3 November 2026). */}
      <LiveRefresh tables={["invoices", "payments", "jobs", ...(reportsOn ? ["payment_reports"] : [])]} />
      <PageHeader
        title="Invoices and payments"
        subtitle={`${counts[""]} row${counts[""] === 1 ? "" : "s"} with money paid or owed${ranged ? ` · documents from ${from || "the start"} to ${to || "today"}` : ""}`}
        actions={can(role, "exportAccounts") || mayPay || viewPay ? <>{mayPay || viewPay ? <RecordPaymentButton size="lg" readOnly={viewPay} /> : null}{can(role, "exportAccounts") ? <LinkButton href="/api/export/accounts" tone="secondary">Export for the accountant</LinkButton> : null}</> : undefined}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <MoneyTilesRow t={tiles} />
      {/* 2 November 2026: payments advisors took and sent to accounts, on All and "Customer says paid / reported". */}
      {show === "" || show === "says_paid" ? <PaymentReportsCard staff={staff} settings={settings} /> : null}

      <Card className="flex flex-col gap-3">
        <form method="get" action="/invoices" className="flex flex-wrap items-end gap-2">
          {show ? <input type="hidden" name="show" value={show} /> : null}
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted w-80 max-w-full">Search<Input name="q" defaultValue={q} placeholder="Plate, VIN, name, mobile or number" data-money-search /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">From<Input name="from" type="date" defaultValue={from} className="w-40" /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">To<Input name="to" type="date" defaultValue={to} className="w-40" /></label>
          <Button type="submit" size="md" tone="secondary">Show</Button>
          {q || from || to ? <Link href={show ? `/invoices?show=${show}` : "/invoices"} className="min-h-11 inline-flex items-center text-sm font-bold underline underline-offset-4">Clear</Link> : null}
        </form>
        <div className="flex flex-wrap gap-1 text-xs font-bold" data-money-filters>
          {FILTERS.map((f) => (
            <Link key={f.key} href={keep({ show: f.key })} className={`min-h-11 inline-flex items-center rounded-control px-3 ${show === f.key ? "bg-ink text-on-dark" : "bg-chip"}`} data-filter={f.key}>{f.label} · {counts[f.key]}</Link>
          ))}
        </div>
        {!ranged && !needle ? <p className="text-xs text-muted" data-money-list-hint>{RECENT_PAID_HINT}</p> : null}
      </Card>

      {unallocated.length ? (
        <Card id="unallocated" className="flex flex-col gap-2 border-amber-bar" data-unallocated-section>
          <SectionLabel right={`${unallocated.length} · AED ${unallocated.filter((p) => p.status === "recorded").reduce((a, p) => a + p.amount_aed, 0).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`}>Unallocated payments</SectionLabel>
          <p className="text-xs text-muted">Money on customers&apos; accounts that is not on a job or invoice yet. Allocate each one when you know what it is for.</p>
          <UnallocatedList rows={unallocated} canAllocate={mayPay} showCustomer />
        </Card>
      ) : null}
      <section className="flex flex-col gap-3" data-money-list>
        <SectionLabel right={<span data-money-list-sum>{listSum}</span>}>{FILTERS.find((f) => f.key === show)?.label ?? "All"}</SectionLabel>
        {filtered.length === 0 ? <Empty title="Nothing here" /> : filtered.map((r) => <MoneyRow key={r.key} r={r} canAddAuth={mayPay} />)}
      </section>

      {can(role, "cardSettlements") ? (
        <details className="rounded-card border border-line bg-white px-5 py-3" data-bank-fees-fold>
          <summary className="cursor-pointer min-h-11 flex items-center text-sm font-bold">Bank fees: card machine {feeRuleWords(bankFeesOf(settings).card)} · payment link {feeRuleWords(bankFeesOf(settings).link)}</summary>
          <div className="mt-2"><BankFeeSettings values={bankFeeValuesOf(settings)} action={saveBankFeesAction} canSave={!staff.viewingAs} /></div>
        </details>
      ) : null}
    </>
  );
}

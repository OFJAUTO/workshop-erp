import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { MoneyRow } from "@/components/MoneyRow";
import { Button, Card, Empty, Input, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { dubaiDate } from "@/lib/jobs";
import { loadMoneyRows, loadMoneyTiles } from "@/lib/money-data";
import { can, type RoleId } from "@/lib/roles";
import { getSettings, bankFeeValuesOf, bankFeesOf } from "@/lib/settings";
import { CounterPaymentsCard, MoneyTilesRow } from "@/app/(app)/dashboard/AccountsDashboard";
import { saveBankFeesAction } from "../card-settlements/actions";
import { BankFeeSettings } from "../card-settlements/BankFeeSettings";
import { feeRuleWords } from "@/lib/bank-fees";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "", label: "All" },
  { key: "awaiting", label: "Awaiting payment" },
  { key: "says_paid", label: "Customer says paid" },
  { key: "part", label: "Part paid" },
  { key: "paid", label: "Paid" },
  { key: "proforma", label: "Proformas" },
  { key: "tax", label: "Tax invoices" },
  { key: "released", label: "Released" },
] as const;

/**
 * Invoices and payments: money only. The tiles, the counter payments to confirm, then one row per car with its
 * money step, filtered by state, dates or a search.
 */
export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; show?: string; from?: string; to?: string; q?: string }> }) {
  const staff = await requirePermission("viewInvoices");
  const role = staff.role_id as RoleId;
  const settings = await getSettings();
  const { message, error, show = "", from = "", to = "", q = "" } = await searchParams;
  const ranged = !!(from || to);
  const rows = await loadMoneyRows(settings, ranged ? { scope: "range", from: from || "2020-01-01", to: to || dubaiDate() } : { scope: "range", from: "2020-01-01", to: dubaiDate() });
  const openRows = await loadMoneyRows(settings, { scope: "open" });
  const tiles = await loadMoneyTiles(openRows);
  // Open cars without an invoice yet sit at the top of "All" and "Awaiting": they come from the open scope.
  const all = [...openRows.filter((r) => !rows.some((x) => x.jobId === r.jobId)), ...rows];
  const needle = q.trim().toLowerCase();
  const searched = needle ? all.filter((r) => [r.plate, r.jobNumber, r.customer, r.car, r.proforma?.number, r.taxInvoice?.number].some((v) => (v ?? "").toLowerCase().includes(needle))) : all;
  const match = (key: string) => (r: (typeof all)[number]) => {
    switch (key) {
      case "awaiting": return r.state.current === "payment" && r.balance > 0.005 && !r.proforma?.customer_says_paid_at;
      case "says_paid": return !!r.proforma?.customer_says_paid_at;
      case "part": return r.paid > 0 && r.balance > 0.005;
      case "paid": return !!(r.taxInvoice ?? r.proforma) && r.balance <= 0.005;
      case "proforma": return !!r.proforma && !r.taxInvoice;
      case "tax": return !!r.taxInvoice;
      case "released": return r.state.current === "released" && !r.isOpen;
      default: return true;
    }
  };
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, searched.filter(match(f.key)).length]));
  const filtered = searched.filter(match(show));
  const keep = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ show, from, to, q, ...next })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/invoices?${s}` : "/invoices";
  };

  return (
    <>
      <LiveRefresh tables={["invoices", "payments", "jobs"]} />
      <PageHeader
        title="Invoices and payments"
        subtitle={`${counts[""]} car${counts[""] === 1 ? "" : "s"}${ranged ? ` · invoices from ${from || "the start"} to ${to || "today"}` : ""}`}
        actions={can(role, "exportAccounts") ? <a href="/api/export/accounts" className="inline-flex items-center justify-center rounded-control font-bold bg-white text-ink border border-line-strong hover:bg-canvas min-h-14 px-6 text-base">Export for the accountant</a> : undefined}
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <MoneyTilesRow t={tiles} />
      {can(role, "verifyPayments") ? <CounterPaymentsCard canConfirm={!staff.viewingAs} returnTo="/invoices" /> : null}

      <Card className="flex flex-col gap-3">
        <form method="get" action="/invoices" className="flex flex-wrap items-end gap-2">
          {show ? <input type="hidden" name="show" value={show} /> : null}
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Search<Input name="q" defaultValue={q} placeholder="Plate, job number, customer or invoice number" className="w-72" data-money-search /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">From<Input name="from" type="date" defaultValue={from} className="w-40" /></label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">To<Input name="to" type="date" defaultValue={to} className="w-40" /></label>
          <Button type="submit" size="md" tone="secondary">Show</Button>
          {q || from || to ? <Link href={show ? `/invoices?show=${show}` : "/invoices"} className="min-h-11 inline-flex items-center text-sm font-bold underline underline-offset-4">Clear</Link> : null}
        </form>
        <div className="flex flex-wrap gap-1 text-xs font-bold" data-money-filters>
          {FILTERS.map((f) => (
            <Link key={f.key} href={keep({ show: f.key })} className={`min-h-9 inline-flex items-center rounded-control px-3 ${show === f.key ? "bg-ink text-white" : "bg-chip"}`} data-filter={f.key}>{f.label} · {counts[f.key]}</Link>
          ))}
        </div>
      </Card>

      <section className="flex flex-col gap-3" data-money-list>
        <SectionLabel right={`${filtered.length}`}>{FILTERS.find((f) => f.key === show)?.label ?? "All"}</SectionLabel>
        {filtered.length === 0 ? <Empty title="Nothing here" /> : filtered.map((r) => <MoneyRow key={r.jobId} r={r} />)}
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

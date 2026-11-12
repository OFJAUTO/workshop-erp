import Link from "next/link";
import { advancesBySupplier } from "@/lib/supplier-payments";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Button, Card, Input, LinkButton, Notice, PageHeader, Select } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { loadPartsBase, partsAccountsView } from "@/lib/parts-accounts";
import { PA_QUICK, PA_STATUS, PA_TABS, aedWords, asPaTab, filterBalances, filterLines, filterLpos, filterProblems, filterReturns, type PaFilter, type PaTab, type PaTotals } from "@/lib/parts-accounts-rules";
import { filterInvoices, invoiceFilterOf, invoiceFilterParams } from "@/lib/supplier-invoice-rows";
import { SupplierInvoicesView, type SiSearch } from "../supplier-invoices/SupplierInvoicesView";
import { LinesTab, LposTab, PaymentsTab, ProblemsTab, ReturnsTab } from "./PartsAccountsTabs";
import { Words } from "@/components/Words";

export const dynamic = "force-dynamic";

type Search = SiSearch & { tab?: string; quick?: string };

/** The page's address with these filters: the shared ones (search, supplier, dates) are kept across tabs. */
function hrefOf(tab: PaTab, f: PaFilter, extra: Record<string, string | undefined> = {}): string {
  const p = new URLSearchParams();
  if (tab !== "lines") p.set("tab", tab);
  for (const [k, v] of Object.entries({ q: f.q, supplier: f.supplier, from: f.from, to: f.to, ...extra })) if (v) p.set(k, v);
  const s = p.toString();
  return `/parts-accounts${s ? `?${s}` : ""}`;
}

/**
 * The figures across the top: the same on every tab, from the rows the shared filters keep. Each box opens the list its
 * figure is made of (the same rule: isBoughtLine, isChargedLine, the unpaid invoices, the problems).
 */
function TotalsStrip({ t, f }: { t: PaTotals; f: PaFilter }) {
  const tiles = [
    { key: "bought", label: "Parts bought", value: aedWords(t.bought), sub: `${t.boughtCount} part line${t.boughtCount === 1 ? "" : "s"} · cost before VAT`, href: hrefOf("lines", f, { quick: "bought" }), tone: "" },
    { key: "charged", label: "Charged to customers", value: aedWords(t.charged), sub: `${t.chargedCount} line${t.chargedCount === 1 ? "" : "s"} on tax invoices · before VAT`, href: hrefOf("lines", f, { quick: "invoiced" }), tone: "" },
    { key: "margin", label: "Parts margin", value: aedWords(t.margin), sub: t.marginPct === null ? "on invoiced lines" : `${t.marginPct}% on invoiced lines`, href: hrefOf("lines", f, { quick: "invoiced" }), tone: t.margin < 0 ? "border-red-bar" : "" },
    { key: "owed", label: "Owed to suppliers", value: aedWords(t.owed), sub: `${t.owedCount} unpaid invoice${t.owedCount === 1 ? "" : "s"} with VAT${t.toFollowCount ? ` · + ${aedWords(t.toFollow)} invoice to follow` : ""}`, href: hrefOf("payments", f, { quick: "unpaid" }), tone: t.owed > 0 ? "border-ink" : "" },
    { key: "problems", label: "Problems", value: String(t.problems), sub: t.problems ? `${t.problemsRed} red · tap to see them` : "nothing to look at ✓", href: hrefOf("problems", f), tone: t.problemsRed ? "border-red-bar" : t.problems ? "border-amber-bar" : "" },
  ];
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3" data-pa-totals>
      {tiles.map((x) => (
        <a key={x.key} href={x.href} className={`flex flex-col gap-0.5 rounded-card border bg-white px-4 py-3 hover:border-ink ${x.tone || "border-line"}`} data-pa-tile={x.key} data-tile-value={x.value}>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{x.label}</span>
          <Words className={`text-xl font-extrabold ${x.key === "problems" && t.problemsRed ? "text-red" : ""}`} text={String(x.value)} />
          <Words className="text-xs text-muted" text={String(x.sub ?? "")} />
        </a>
      ))}
    </div>
  );
}

/**
 * PARTS ACCOUNTS (3 November 2026, section 12), for accounts and the owner: the supplier side of the money in six tabs
 * (parts lines, LPOs, supplier invoices, payments to suppliers, returns and credits, problems), the totals across the
 * top, ONE filter bar (search, supplier, status, dates, quick chips) and the Excel export of the tab (or everything).
 */
export default async function PartsAccountsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const staff = await requirePermission("viewPartsAccounts");
  const sp = await searchParams;
  const tab = asPaTab(sp.tab);
  const f: PaFilter = { q: sp.q?.trim() || undefined, supplier: sp.supplier || undefined, from: sp.from || undefined, to: sp.to || undefined, status: sp.status || undefined, quick: sp.quick || undefined };
  const base = await loadPartsBase();
  const { totals, shared } = partsAccountsView(base, f);
  const sup = base.suppliers;
  // Each tab counts its OWN list (5 November 2026): the Supplier invoices tab counts exactly what it shows - its own
  // filters while it is open, else the search, supplier and dates its link carries.
  const linkSp: Record<string, string | undefined> = { q: f.q, supplier: f.supplier, from: f.from, to: f.to };
  const invoiceTabCount = filterInvoices(base.invoices, invoiceFilterOf((k) => (tab === "invoices" ? sp[k] : linkSp[k])), base.invoicePartNames).length;
  const counts: Record<PaTab, number> = { lines: shared.lines.length, lpos: shared.lpos.length, invoices: invoiceTabCount, payments: shared.balances.length, returns: shared.returns.length, problems: shared.problems.length };
  const quick = PA_QUICK[tab];
  const statuses = PA_STATUS[tab];
  // The supplier list of the filter: every supplier the page has rows for (and the one chosen), by name.
  const used = new Set([...shared.lines.map((l) => l.supplierId), ...shared.lpos.map((l) => l.supplierId), ...base.invoices.map((r) => r.supplierId), f.supplier ?? null].filter((x): x is string => !!x));
  const supplierOptions = sup.filter((s) => used.has(s.id) || s.isActive).sort((a, b) => a.name.localeCompare(b.name));
  // The export link carries exactly the filters the tab on the screen uses: on Supplier invoices its own (Unpaid, Match
  // problems, the car… through THE list invoiceFilterParams), elsewhere the shared bar and the quick chip.
  const exportParams = new URLSearchParams(
    tab === "invoices"
      ? [["tab", "invoices"], ...invoiceFilterParams(sp)]
      : Object.entries({ tab, q: f.q, supplier: f.supplier, from: f.from, to: f.to, status: f.status, quick: f.quick }).filter((e): e is [string, string] => !!e[1]),
  );
  const quickCount = (key: string): number => {
    switch (tab) {
      case "lines": return filterLines(shared.lines, { quick: key }, sup).length;
      case "lpos": return filterLpos(shared.lpos, { quick: key }, sup).length;
      case "payments": return filterBalances(shared.balances, key).length;
      case "returns": return filterReturns(shared.returns, { quick: key }, sup).length;
      case "problems": return filterProblems(shared.problems, { quick: key }, sup).length;
      default: return 0;
    }
  };
  const acts = !staff.viewingAs;

  return (
    <>
      {/* Not part_items: the Parts table autosaves while pricing, and this page is heavy to rebuild; ordering, receiving
          and paying all write the LPO, and invoicing writes invoices (both in the live publication, readable by owner and accounts). */}
      <LiveRefresh tables={["purchase_orders", "invoices"]} />
      <PageHeader
        title="Parts accounts"
        subtitle="Every part bought for a car, its LPO, the supplier invoice, what we owe the suppliers, returns waiting for a credit note, and the problems."
        actions={
          <>
            <LinkButton href={`/api/export/parts-accounts?${exportParams.toString()}`} tone="secondary" size="lg" data-pa-export>Export this tab</LinkButton>
            <LinkButton href={`/api/export/parts-accounts?${new URLSearchParams([["tab", "all"], ...Array.from(exportParams.entries()).filter(([k]) => ["q", "supplier", "from", "to"].includes(k))]).toString()}`} tone="ghost" size="lg" data-pa-export-all>Export everything</LinkButton>
          </>
        }
      />
      {/* The Supplier invoices tab shows the answer of its buttons itself, next to them (inside the opened invoice). */}
      {tab !== "invoices" && sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      {tab !== "invoices" && sp.error ? <Notice tone="error">{sp.error}</Notice> : null}

      <TotalsStrip t={totals} f={f} />

      <nav className="flex flex-wrap gap-1 text-xs font-bold" aria-label="Parts accounts tabs" data-pa-tabs>
        {PA_TABS.map((t) => (
          <Link key={t.key} href={hrefOf(t.key, f)} className={`inline-flex min-h-11 items-center rounded-control px-3 ${tab === t.key ? "bg-ink text-on-dark" : "bg-chip"}`} aria-current={tab === t.key ? "page" : undefined} data-pa-tab={t.key}>
            {t.label} · {counts[t.key]}
          </Link>
        ))}
      </nav>

      {tab === "invoices" ? (
        <SupplierInvoicesView sp={sp} staff={staff} place="parts-accounts" />
      ) : (
        <>
          <Card className="flex flex-col gap-3" data-pa-filters>
            <form method="get" action="/parts-accounts" className="flex flex-wrap items-end gap-2">
              {tab !== "lines" ? <input type="hidden" name="tab" value={tab} /> : null}
              {f.quick ? <input type="hidden" name="quick" value={f.quick} /> : null}
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Search<Input name="q" defaultValue={f.q ?? ""} placeholder="Plate, job no., VIN, part, LPO or invoice no." className="w-72" spell={false} data-pa-search /></label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Supplier
                <Select name="supplier" defaultValue={f.supplier ?? ""} className="w-56" data-pa-supplier-filter>
                  <option value="">All suppliers</option>
                  {supplierOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </label>
              {statuses.length ? (
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Status
                  <Select name="status" defaultValue={f.status ?? ""} className="w-56" data-pa-status-filter>
                    <option value="">Any status</option>
                    {statuses.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </Select>
                </label>
              ) : null}
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">From<Input type="date" name="from" defaultValue={f.from ?? ""} className="w-40" data-pa-from /></label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">To<Input type="date" name="to" defaultValue={f.to ?? ""} className="w-40" data-pa-to /></label>
              <Button type="submit" size="md" tone="secondary" data-pa-show>Show</Button>
              {f.q || f.supplier || f.from || f.to || f.status || f.quick ? <Link href={hrefOf(tab, {})} className="inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4" data-pa-clear>Clear</Link> : null}
            </form>
            {quick.length ? (
              <div className="flex flex-wrap gap-1 text-xs font-bold" data-pa-quicks>
                {quick.map((c) => {
                  const on = f.quick === c.key;
                  return (
                    <Link key={c.key} href={hrefOf(tab, f, { status: f.status, quick: on ? undefined : c.key })} className={`inline-flex min-h-11 items-center rounded-control px-3 ${on ? "bg-ink text-on-dark" : "bg-chip"}`} aria-pressed={on} data-pa-quick={c.key}>
                      {c.label} · {quickCount(c.key)}
                    </Link>
                  );
                })}
              </div>
            ) : null}
            <p className="text-xs text-muted">
              {tab === "lines" ? "Dates: when the part was ordered (else priced). Cost is the supplier invoice price when there is one, else the LPO price; selling is the tax invoice line, else the proforma, else the approved quotation." : tab === "lpos" ? "Dates: when the LPO was raised. Amounts before VAT include courier and freight charges." : tab === "payments" ? "Dates: the supplier invoice date. Amounts with VAT, from the Supplier invoices tab. Pay a supplier on its LPO (Paid to supplier)." : tab === "returns" ? "Dates: when the part was returned (or marked not needed)." : "Dates: since when the problem stands. Red first."}
            </p>
          </Card>

          {tab === "lines" ? <LinesTab rows={filterLines(shared.lines, f, sup)} /> : null}
          {tab === "lpos" ? <LposTab rows={filterLpos(shared.lpos, f, sup)} redDays={base.limits.invoiceRedDays} /> : null}
          {tab === "payments" ? <PaymentsTab rows={filterBalances(shared.balances, f.quick)} canPay={acts} advances={Object.fromEntries(await advancesBySupplier())} /> : null}
          {tab === "returns" ? <ReturnsTab rows={filterReturns(shared.returns, f, sup)} waitDays={base.limits.creditWaitDays} canDecide={staff.role_id === "owner"} /> : null}
          {tab === "problems" ? <ProblemsTab rows={filterProblems(shared.problems, f, sup)} /> : null}
        </>
      )}
    </>
  );
}

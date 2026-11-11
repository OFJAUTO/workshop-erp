import Link from "next/link";
import { HrExpiringTile } from "@/components/HrExpiringTile";
import { hrReady } from "@/lib/hr";
import { LiveRefresh } from "@/components/LiveRefresh";
import { HomeHeader } from "@/components/HomeHeader";
import { MoneyRow } from "@/components/MoneyRow";
import { WaitingPanel } from "@/components/WaitingPanel";
import { accountsWaitingExtra } from "@/lib/accounts-waiting";
import { LinkButton, SectionLabel } from "@/components/ui";
import { PaymentReportsCard } from "@/components/PaymentReportsCard";
import { paymentReportsReady } from "@/lib/schema-ready";
import type { CurrentStaff } from "@/lib/auth";
import { loadMoneyList, loadMoneyTiles, type MoneyTiles } from "@/lib/money-data";
import { AWAITING_GROUPS, awaitingGroupOf, inFilter } from "@/lib/money-list";
import type { Settings } from "@/lib/settings";

/** Whole dirhams, "AED" kept on the same line as its figure. */
const money = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;
const exact = (n: number) => n.toFixed(2);

/**
 * The figures across the top of the accounts screens (3 November 2026): each money tile is the sum of the list its link
 * opens on Invoices and payments (Awaiting payment, Collected today, Tax invoices today), made from the same rows.
 */
export function MoneyTilesRow({ t }: { t: MoneyTiles }) {
  const cars = t.awaitingCount - t.awaitingChargeCount;
  const who = `${cars} car${cars === 1 ? "" : "s"}${t.awaitingChargeCount ? ` + ${t.awaitingChargeCount} pending charge${t.awaitingChargeCount === 1 ? "" : "s"}` : ""}`;
  const tiles = [
    { label: "Awaiting payment", value: money(t.awaitingAed), sub: `${who} · ${money(t.dueNowAed)} due now · ${money(t.wipAed)} work in progress`, href: "/invoices?show=awaiting", tone: t.awaitingCount ? "border-ink" : "", amount: exact(t.awaitingAed), count: t.awaitingCount },
    { label: "Collected today", value: money(t.todayAed), sub: `${t.todayPayments} payment${t.todayPayments === 1 ? "" : "s"} · this month ${money(t.collectedMonth)}`, href: "/invoices?show=today", tone: "", amount: exact(t.todayAed), count: t.todayPayments },
    { label: "Tax invoices today", value: String(t.taxTodayCount), sub: "issued today", href: "/invoices?show=tax_today", tone: "", amount: "", count: t.taxTodayCount },
    { label: "LPOs waiting approval", value: String(t.lposWaiting), sub: "to approve", href: "/parts/orders", tone: t.lposWaiting ? "border-amber-bar" : "", amount: "", count: t.lposWaiting },
    { label: "Supplier invoices to check", value: String(t.supplierInvoicesToCheck), sub: "new, waiting for invoice or price differs", href: "/supplier-invoices", tone: t.supplierInvoicesToCheck ? "border-amber-bar" : "", amount: "", count: t.supplierInvoicesToCheck },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3" data-money-tiles>
      {tiles.map((x) => (
        <a key={x.label} href={x.href} className={`min-w-0 rounded-card border bg-white px-4 py-3 flex flex-col gap-0.5 hover:border-ink ${x.tone || "border-line"}`} data-tile={x.label} data-tile-amount={x.amount} data-tile-count={x.count}>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">{x.label}</span>
          <span className="text-xl font-extrabold whitespace-nowrap">{x.value}</span>
          <span className="text-xs text-muted">{x.sub}</span>
        </a>
      ))}
    </div>
  );
}

/**
 * The accounts dashboard: money only. Tiles, the payments advisors sent to record, then every balance due grouped by
 * where it stands (due now, proforma to send, in work with an advance, in work with nothing paid) - the same rows as
 * Invoices and payments - and the other money today or at the money steps. Pending charges are never rows here (the
 * owner's rule of 31 October: cars not in the workshop stay off the dashboard); the tile counts them, so one plain
 * line under Awaiting payment says how much of it they are and links to Pending charges.
 */
export async function AccountsDashboard({ staff, settings }: { staff: CurrentStaff; settings: Settings }) {
  const all = await loadMoneyList(settings, { scope: "now" });
  const tiles = await loadMoneyTiles(all);
  // Not here: pending charges (one line below) and cars that left paid in full lately (Invoices and payments has them).
  const rows = all.filter((r) => r.kind !== "charge" && !r.recentPaidOnly);
  const awaiting = rows.filter((r) => inFilter("awaiting", r));
  const others = rows.filter((r) => !inFilter("awaiting", r));
  const advances = rows.filter((r) => inFilter("advance", r));
  const reportsOn = await paymentReportsReady();
  return (
    <>
      {/* No "quotations": approvals write the job too, and the editor's heartbeat would re-render this page (3 Nov). */}
      <LiveRefresh tables={["invoices", "payments", "jobs", "purchase_orders", ...(reportsOn ? ["payment_reports"] : [])]} />
      <HomeHeader staff={staff} actions={<LinkButton href="/invoices" tone="secondary" size="lg">Invoices and payments</LinkButton>} />
      {/* 11 November 2026 (Section 15): the head accountant sees the HR documents tile. */}
      {staff.is_head_accountant && !staff.viewingAs && (await hrReady()) ? <HrExpiringTile /> : null}
      <MoneyTilesRow t={tiles} />
      <WaitingPanel staff={staff} extra={await accountsWaitingExtra()} />
      {/* 2 November 2026: the advisors' payments to record (where the old counter-payments card was; advisors never record). */}
      <PaymentReportsCard staff={staff} settings={settings} />
      <section className="flex flex-col gap-3" data-awaiting-payment>
        <SectionLabel right={`${awaiting.length} · ${money(tiles.awaitingAed - tiles.awaitingChargeAed)}`}>Awaiting payment</SectionLabel>
        {tiles.awaitingChargeCount ? (
          <p className="text-sm text-muted" data-pending-charges-line>
            Plus {tiles.awaitingChargeCount} pending charge{tiles.awaitingChargeCount === 1 ? "" : "s"} (cars not in the workshop) · {money(tiles.awaitingChargeAed)} ·{" "}
            <Link href="/pending-charges" className="inline-flex min-h-11 items-center font-bold text-ink underline underline-offset-4">Pending charges</Link>
          </p>
        ) : null}
        {awaiting.length === 0 ? <p className="text-sm text-muted">Nothing outstanding.</p> : null}
        {AWAITING_GROUPS.map((g) => {
          const list = awaiting.filter((r) => awaitingGroupOf(r) === g.key);
          if (!list.length) return null;
          return (
            <div key={g.key} className="flex flex-col gap-2" data-awaiting-group={g.key}>
              <span className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.08em] text-muted">
                {g.label} · {list.length} · {money(list.reduce((a, r) => a + (r.balance ?? 0), 0))}
                {g.key === "wip_advance" && advances.length ? <Link href="/invoices?show=advance" className="min-h-11 inline-flex items-center normal-case tracking-normal underline underline-offset-4" data-advances-link>Every advance ({advances.length})</Link> : null}
              </span>
              {list.map((r) => <MoneyRow key={r.key} r={r} canAddAuth={!staff.viewingAs} />)}
            </div>
          );
        })}
      </section>
      <section className="flex flex-col gap-3" data-other-money>
        <SectionLabel right={`${others.length}`}>Other money: paid, today, customer credit</SectionLabel>
        {others.length === 0 ? <p className="text-sm text-muted">None.</p> : others.map((r) => <MoneyRow key={r.key} r={r} canAddAuth={!staff.viewingAs} />)}
      </section>
    </>
  );
}

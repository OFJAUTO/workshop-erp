import { LiveRefresh } from "@/components/LiveRefresh";
import { HomeHeader } from "@/components/HomeHeader";
import { MoneyRow } from "@/components/MoneyRow";
import { WaitingPanel } from "@/components/WaitingPanel";
import {Badge, Button, Card, LinkButton, SectionLabel} from "@/components/ui";
import type { CurrentStaff } from "@/lib/auth";
import { formatDayTime } from "@/lib/format";
import { METHOD_LABELS } from "@/lib/invoice-data";
import { loadCounterPaymentsToConfirm, loadMoneyRows, loadMoneyTiles, type MoneyTiles } from "@/lib/money-data";
import { depositsNotInvoiced } from "@/lib/deposits";
import type { Settings } from "@/lib/settings";
import { verifyPaymentAction } from "@/app/(app)/invoices/actions";

const money = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;

/** The figures across the top of the accounts screens. */
export function MoneyTilesRow({ t }: { t: MoneyTiles }) {
  const tiles = [
    { label: "Awaiting payment", value: money(t.awaitingAed), sub: `${t.awaitingCount} car${t.awaitingCount === 1 ? "" : "s"}`, href: "/invoices?show=awaiting", tone: t.awaitingCount ? "border-ink" : "" },
    { label: "Collected today", value: money(t.collectedToday), sub: `this month ${money(t.collectedMonth)}`, href: "/invoices?show=paid" },
    { label: "Tax invoices today", value: String(t.taxInvoicesToday), sub: "issued today", href: "/invoices?show=tax" },
    { label: "LPOs waiting approval", value: String(t.lposWaiting), sub: "to approve", href: "/parts/orders", tone: t.lposWaiting ? "border-amber-bar" : "" },
    { label: "Supplier invoices to check", value: String(t.supplierInvoicesToCheck), sub: "to follow or price differs", href: "/parts/orders?tab=invoices", tone: t.supplierInvoicesToCheck ? "border-amber-bar" : "" },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3" data-money-tiles>
      {tiles.map((x) => (
        <a key={x.label} href={x.href} className={`rounded-card border bg-white px-4 py-3 flex flex-col gap-0.5 hover:border-ink ${x.tone || "border-line"}`} data-tile={x.label}>
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">{x.label}</span>
          <span className="text-xl font-extrabold">{x.value}</span>
          <span className="text-xs text-muted">{x.sub}</span>
        </a>
      ))}
    </div>
  );
}

/** "Confirm today's counter payments": cash and card taken by advisors, one Confirmed button each. */
export async function CounterPaymentsCard({ canConfirm, returnTo }: { canConfirm: boolean; returnTo: string }) {
  const list = await loadCounterPaymentsToConfirm();
  if (!list.length) return null;
  return (
    <Card className="flex flex-col gap-2 border-ink" data-counter-payments>
      <SectionLabel right={`${list.length}`}>Confirm today&apos;s counter payments</SectionLabel>
      <p className="text-xs text-muted">Recorded by advisors at the counter. Tick each one once the cash or the card slip is with you.</p>
      <ul className="divide-y divide-line">
        {list.map((p) => (
          <li key={p.id} className="py-2 flex flex-wrap items-center gap-3 text-sm" data-counter-row={p.number}>
            <span className="font-semibold">{p.number}</span>
            <span>{p.plate ?? p.invoiceNumber ?? ""}</span>
            <Badge tone="neutral">{METHOD_LABELS[p.method]}</Badge>
            <span className="text-muted">{formatDayTime(p.received_at)} · by {p.byName}</span>
            <Badge tone="amber">Recorded by advisor, to confirm</Badge>
            <span className="ml-auto font-semibold">AED {p.amount_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
            {canConfirm ? <form action={verifyPaymentAction.bind(null, p.id)}><input type="hidden" name="return_to" value={returnTo} /><Button type="submit" size="md" tone="secondary">Confirmed</Button></form> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The accounts dashboard: money only. Tiles, the counter payments to confirm, and every open car from Ready onwards with its money step. */
export async function AccountsDashboard({ staff, settings }: { staff: CurrentStaff; settings: Settings }) {
  const rows = await loadMoneyRows(settings, { scope: "open" });
  const tiles = await loadMoneyTiles(rows);
  const awaiting = rows.filter((r) => r.state.current === "payment");
  const others = rows.filter((r) => r.state.current !== "payment");
  const deposits = await depositsNotInvoiced();
  return (
    <>
      <LiveRefresh tables={["invoices", "payments", "jobs", "purchase_orders"]} pollMs={60000} />
      <HomeHeader staff={staff} actions={<LinkButton href="/invoices" tone="secondary" size="lg">Invoices and payments</LinkButton>} />
      <MoneyTilesRow t={tiles} />
      <WaitingPanel staff={staff} />
      <CounterPaymentsCard canConfirm={!staff.viewingAs} returnTo="/dashboard" />
      {deposits.length ? (
        <section className="flex flex-col gap-3" data-deposits-not-invoiced>
          <SectionLabel right={`${deposits.length}`}>Deposits received, not yet on an invoice</SectionLabel>
          <Card className="flex flex-col divide-y divide-line">
            {deposits.map((d) => (
              <div key={d.id} className="py-2 flex flex-wrap items-center gap-3 text-sm" data-deposit-not-invoiced={d.number}>
                <span className="font-bold">{d.plate}</span>
                <span className="text-muted">{d.customer}</span>
                <span>{d.number} · {METHOD_LABELS[d.method]} · {formatDayTime(d.received_at)}</span>
                <span className="ml-auto font-semibold">{money(d.amount_aed)}</span>
                <LinkButton href={`/jobs/${d.job_id}/invoice`} tone="secondary" size="md">Money page</LinkButton>
              </div>
            ))}
          </Card>
          <p className="text-xs text-muted">A deposit lands on the proforma the moment it is prepared, and on the tax invoice as &quot;Less deposit received&quot;.</p>
        </section>
      ) : null}
      <section className="flex flex-col gap-3" data-awaiting-payment>
        <SectionLabel right={`${awaiting.length}`}>Awaiting payment</SectionLabel>
        {awaiting.length === 0 ? <p className="text-sm text-muted">Nothing outstanding.</p> : awaiting.map((r) => <MoneyRow key={r.jobId} r={r} />)}
      </section>
      <section className="flex flex-col gap-3" data-other-money>
        <SectionLabel right={`${others.length}`}>Other cars at the money steps</SectionLabel>
        {others.length === 0 ? <p className="text-sm text-muted">None.</p> : others.map((r) => <MoneyRow key={r.jobId} r={r} />)}
      </section>
    </>
  );
}

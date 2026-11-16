import { Badge, Button, Card, Input, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { refuse } from "@/lib/refusal";
import { formatDate, formatDateTime } from "@/lib/format";
import { MOVEMENT_WORDS, lastMonthEnd } from "@/lib/stock-report-rules";
import { listStockSnapshots, stockAsOfDay, stockMovementsBetween, stockSnapshotsReady } from "@/lib/stock-report";

export const dynamic = "force-dynamic";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyOf = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
const isDay = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/**
 * THE stock report (16 November 2026, Section 1): owner and accounts. The stock count and value live in the ERP only
 * (Zoho gets the supplier bills for stock purchases). Stock as of any day per item (quantity, cost, value), the
 * movements behind it (in from LPOs, out to jobs, counts and adjustments), the saved month-end snapshots, Excel.
 */
export default async function StockReportPage({ searchParams }: { searchParams: Promise<{ asof?: string; from?: string; to?: string; snapshot?: string }> }) {
  const staff = await requireStaff();
  if (!["owner", "accounts"].includes(staff.role_id)) await refuse("no_permission", { path: "/stock-report" });
  const sp = await searchParams;
  // eslint-disable-next-line react-hooks/purity
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const day = isDay(sp.asof) && sp.asof! <= today ? sp.asof! : today;
  const from = isDay(sp.from) ? sp.from! : `${day.slice(0, 7)}-01`;
  const to = isDay(sp.to) ? sp.to! : day;
  const [stock, moves, snapshots, snapOn] = await Promise.all([stockAsOfDay(day), stockMovementsBetween(from, to), listStockSnapshots(), stockSnapshotsReady()]);
  const q = new URLSearchParams({ asof: day, from, to }).toString();
  const inValue = moves.filter((m) => m.value > 0).reduce((a, m) => a + m.value, 0);
  const outValue = moves.filter((m) => m.value < 0).reduce((a, m) => a + m.value, 0);
  return (
    <div className="flex flex-col gap-4" data-stock-report>
      <PageHeader title="Stock report" subtitle="The stock count and value live in the ERP only. Zoho gets the supplier bills for stock purchases." actions={<LinkButton href={`/api/export/stock?${q}`} tone="secondary" size="lg" data-stock-export>Export to Excel</LinkButton>} />
      <Card className="flex flex-col gap-3">
        <form className="flex flex-wrap items-end gap-3" data-stock-report-form>
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs font-semibold text-muted">Stock as of</span><Input type="date" name="asof" defaultValue={day} max={today} data-stock-asof /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs font-semibold text-muted">Movements from</span><Input type="date" name="from" defaultValue={from} max={today} /></label>
          <label className="flex flex-col gap-1 text-sm"><span className="text-xs font-semibold text-muted">to</span><Input type="date" name="to" defaultValue={to} max={today} /></label>
          <Button type="submit" size="md" data-stock-report-show>Show</Button>
          <LinkButton href={`/stock-report?asof=${lastMonthEnd(today)}`} tone="ghost" size="md">Last month end</LinkButton>
        </form>
      </Card>

      <Card className="flex flex-col gap-2" data-stock-asof-card>
        <SectionLabel right={`${stock.rows.length} items`}>Stock as of {formatDate(day)}</SectionLabel>
        <p className="text-lg font-extrabold" data-stock-total-value={stock.totalValue.toFixed(2)}>Value {aed(stock.totalValue)}</p>
        {stock.rows.length ? (
          <div className="overflow-x-auto" data-scroll-ok>
            <table className="w-full min-w-[36rem] text-sm">
              <thead><tr className="border-b border-line text-left text-xs uppercase tracking-[0.06em] text-muted"><th className="py-2">Item</th><th>Part number</th><th className="text-right">Quantity</th><th className="text-right">Cost each</th><th className="text-right">Value</th></tr></thead>
              <tbody>
                {stock.rows.map((r) => (
                  <tr key={r.itemId} className="border-b border-line" data-stock-row={r.itemId}>
                    <td className="py-2 font-semibold uppercase">{r.name}</td>
                    <td className="text-muted">{r.partNumber ?? "—"}</td>
                    <td className="text-right whitespace-nowrap">{qtyOf(r.quantity)}{r.unit ? ` ${r.unit}` : ""}</td>
                    <td className="text-right whitespace-nowrap">{aed(r.unitCost)}</td>
                    <td className="text-right whitespace-nowrap font-semibold">{aed(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted">Nothing on the shelf on that day.</p>}
      </Card>

      <Card className="flex flex-col gap-2" data-stock-movements>
        <SectionLabel right={`${moves.length}`}>Movements {formatDate(from)} – {formatDate(to)}</SectionLabel>
        <p className="text-sm">In {aed(inValue)} · out {aed(Math.abs(outValue))}</p>
        {moves.length ? (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {moves.slice(0, 300).map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2" data-stock-movement={m.kind}>
                <span className="text-xs text-muted whitespace-nowrap">{formatDateTime(m.at)}</span>
                <span className="font-semibold uppercase">{m.item}</span>
                <Badge tone="neutral">{MOVEMENT_WORDS[m.kind] ?? m.kind}</Badge>
                <span className="whitespace-nowrap">{m.quantity > 0 ? "+" : ""}{qtyOf(m.quantity)} × {aed(m.unitCost)}</span>
                {m.job ? <span className="text-muted">{m.job}</span> : null}
                {m.lpo ? <span className="text-muted">{m.lpo}</span> : null}
                <span className="ml-auto whitespace-nowrap font-semibold">{aed(m.value)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No movements in this period.</p>}
      </Card>

      <Card className="flex flex-col gap-2" data-stock-snapshots>
        <SectionLabel>Month-end snapshots</SectionLabel>
        {!snapOn ? <p className="text-sm text-muted" data-stock-snapshots-dormant>Month-end snapshots start once the database change is applied (waiting for the owner&apos;s apply). The stock as of any month end is shown above meanwhile (pick the day).</p> : snapshots.length ? (
          <ul className="flex flex-col divide-y divide-line text-sm">
            {snapshots.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2" data-stock-snapshot={s.asOf}>
                <span className="font-semibold">{formatDate(s.asOf)}</span>
                <span>{s.itemCount} items · {aed(s.totalValue)}</span>
                <span className="text-xs text-muted">saved {formatDateTime(s.createdAt)}</span>
                <LinkButton href={`/api/export/stock?snapshot=${s.asOf}`} tone="ghost" size="md">Excel</LinkButton>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">The first snapshot is saved on the 1st of next month.</p>}
      </Card>
    </div>
  );
}

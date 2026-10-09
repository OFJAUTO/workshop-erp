import Link from "next/link";
import { Badge, Card, Empty, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { dailyProfit, jobProfits } from "@/lib/profit";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

const daysAgoIso = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/** Profit per invoice for the owner and accounts: revenue minus parts, other costs, stock, clocked labour and bank charges. Provisional ones are marked. */
export default async function ProfitPage() {
  await requirePermission("viewProfitList");
  const settings = await getSettings();
  const [rows, today] = await Promise.all([jobProfits(settings, { from: daysAgoIso(60), limit: 300 }), dailyProfit(settings)]);
  const sum = (k: "revenue" | "partsCost" | "otherCost" | "stockCost" | "labourCost" | "bankCharges" | "profit") => rows.reduce((a, r) => a + r[k], 0);
  return (
    <>
      <PageHeader title="Profit per invoice" subtitle={`Last 60 days · ${rows.length} invoice${rows.length === 1 ? "" : "s"} · today ${aed(today.invoicedProfit)} of the ${aed(today.target)} daily target · this month ${today.carry >= 0 ? "ahead" : "behind"} by ${aed(Math.abs(today.carry))} before today`} />
      <Card className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <span>Revenue before VAT <span className="font-bold">{aed(sum("revenue"))}</span></span>
        <span>Parts <span className="font-bold">{aed(sum("partsCost"))}</span></span>
        <span>Other and recovery <span className="font-bold">{aed(sum("otherCost"))}</span></span>
        <span>Stock <span className="font-bold">{aed(sum("stockCost"))}</span></span>
        <span>Clocked labour <span className="font-bold">{aed(sum("labourCost"))}</span></span>
        <span>Bank charges <span className="font-bold">{aed(sum("bankCharges"))}</span></span>
        <span className="text-base">Profit <span className="font-extrabold">{aed(sum("profit"))}</span></span>
      </Card>
      {rows.length === 0 ? <Empty title="No invoices yet" /> : null}
      <Card className="p-0 overflow-hidden">
        <SectionLabel>Invoices</SectionLabel>
        <ul className="divide-y divide-line text-sm">
          {rows.map((r) => (
            <li key={r.invoice.id} className="px-5 py-2.5 flex flex-wrap items-center gap-3">
              <Link href={`/invoices/${r.invoice.id}`} className="font-extrabold underline underline-offset-4">{r.invoice.number}</Link>
              <span className="text-muted">{formatDate(r.invoice.issued_at)}</span>
              <span className="font-semibold">{r.plate ?? ""} · {r.jobNumber ?? ""}</span>
              {r.provisional ? <Badge tone="amber">Provisional: {r.provisionalWhy.join(", ")}</Badge> : <Badge tone="green">Final</Badge>}
              {r.balance > 0 ? <Badge tone="red">AED {r.balance.toFixed(0)} unpaid</Badge> : null}
              <span className="ml-auto flex gap-4 text-xs text-muted">
                <span>rev {r.revenue.toFixed(0)}</span>
                <span>parts {r.partsCost.toFixed(0)}</span>
                <span>other {(r.otherCost + r.stockCost).toFixed(0)}</span>
                <span>labour {r.labourCost.toFixed(0)} ({Math.round(r.labourMinutes / 6) / 10} h)</span>
                <span>bank {r.bankCharges.toFixed(0)}</span>
              </span>
              <span className={`w-28 text-right text-base font-extrabold ${r.profit < 0 ? "text-red" : ""}`}>{aed(r.profit)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

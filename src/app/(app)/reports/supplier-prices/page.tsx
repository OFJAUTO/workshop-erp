import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { monthLabel } from "@/lib/owner-report";
import { changeWords, lineChange } from "@/lib/price-change";
import { createAdminClient } from "@/lib/supabase/admin";
import { ReportTabs, monthParam } from "../ReportTabs";

export const dynamic = "force-dynamic";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * SUPPLIER PRICE CHANGES (1 November 2026): every line whose supplier invoice differs from the approved LPO, per month
 * and per supplier - how often and how much - so the owner sees which suppliers change prices after ordering.
 */
export default async function SupplierPricesReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") redirect("/dashboard");
  const { month: m } = await searchParams;
  const month = monthParam(m);
  const from = `${month}-01`;
  const to = new Date(`${month}-01T12:00:00Z`);
  to.setUTCMonth(to.getUTCMonth() + 1);
  const admin = createAdminClient();
  const { data: pos } = await admin.from("purchase_orders").select("id, number, supplier_name, supplier_invoice_date, supplier_invoice_at, job_id").eq("is_active", true).gte("supplier_invoice_date", from).lt("supplier_invoice_date", to.toISOString().slice(0, 10));
  const poList = (pos ?? []) as { id: string; number: string; supplier_name: string; supplier_invoice_date: string | null; job_id: string | null }[];
  const { data: lineRows } = poList.length ? await admin.from("purchase_order_lines").select("po_id, description, quantity, received_qty, unit_cost, invoice_unit_cost, invoice_check").in("po_id", poList.map((p) => p.id)).eq("is_active", true).not("invoice_unit_cost", "is", null) : { data: [] };
  const lines = ((lineRows ?? []) as { po_id: string; description: string; quantity: number | string; received_qty: number | string; unit_cost: number | string; invoice_unit_cost: number | string; invoice_check: string | null }[])
    .map((l) => ({ ...l, quantity: Number(l.quantity), received_qty: Number(l.received_qty), unit_cost: Number(l.unit_cost), invoice_unit_cost: Number(l.invoice_unit_cost) }))
    .filter((l) => lineChange(l));
  const poOf = new Map(poList.map((p) => [p.id, p]));
  const bySupplier = new Map<string, { count: number; up: number; down: number }>();
  for (const l of lines) {
    const c = lineChange(l)!;
    const name = poOf.get(l.po_id)?.supplier_name ?? "Supplier";
    const cur = bySupplier.get(name) ?? { count: 0, up: 0, down: 0 };
    bySupplier.set(name, { count: cur.count + 1, up: r2(cur.up + Math.max(0, c.total)), down: r2(cur.down + Math.min(0, c.total)) });
  }
  const rows = Array.from(bySupplier.entries()).sort((a, b) => b[1].up - a[1].up || b[1].count - a[1].count);
  const up = r2(rows.reduce((a, [, r]) => a + r.up, 0));
  const down = r2(rows.reduce((a, [, r]) => a + r.down, 0));
  return (
    <>
      <PageHeader title="Supplier price changes" subtitle={`${monthLabel(month)}: lines whose supplier invoice differs from the approved LPO.`} />
      <ReportTabs current="/reports/supplier-prices" month={month} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-sp-totals>
        <Card className="flex flex-col gap-1"><span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Lines changed</span><span className="text-2xl font-extrabold">{lines.length}</span></Card>
        <Card className="flex flex-col gap-1"><span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Price up after approval</span><span className="text-2xl font-extrabold text-red">{aed(up)}</span></Card>
        <Card className="flex flex-col gap-1"><span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">Price down</span><span className="text-2xl font-extrabold text-green-text">{aed(Math.abs(down))}</span></Card>
      </div>
      <Card className="flex flex-col gap-2" data-sp-suppliers>
        <SectionLabel right={`${rows.length}`}>By supplier</SectionLabel>
        {rows.length ? (
          <ul className="divide-y divide-line text-sm">
            {rows.map(([name, r]) => (
              <li key={name} className="flex flex-wrap items-center gap-2 py-2" data-sp-supplier={name}>
                <span className="min-w-0 flex-1 font-semibold uppercase">{name}</span>
                <span className="text-muted">{r.count} time{r.count === 1 ? "" : "s"}</span>
                <span className="font-bold text-red">+{aed(r.up)}</span>
                {r.down ? <span className="font-bold text-green-text">−{aed(Math.abs(r.down))}</span> : null}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">No supplier changed a price this month.</p>}
      </Card>
      {lines.length ? (
        <Card className="flex flex-col gap-2" data-sp-lines>
          <SectionLabel>Every change</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {lines.map((l, i) => {
              const po = poOf.get(l.po_id);
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 py-1.5">
                  <Link href={`/parts/orders/${l.po_id}`} className="font-semibold underline underline-offset-4">{po?.number}</Link>
                  <span className="text-muted">{po?.supplier_name}</span>
                  <span className="min-w-0 flex-1 uppercase">{l.description}</span>
                  <span className="font-semibold">{changeWords(l)}</span>
                  {l.invoice_check === "mismatch" ? <span className="text-xs font-bold text-red">waits for the owner</span> : l.invoice_check === "disputed" ? <span className="text-xs font-bold text-amber-text">queried</span> : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </>
  );
}

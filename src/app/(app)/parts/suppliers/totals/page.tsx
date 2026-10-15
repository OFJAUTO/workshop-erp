import Link from "next/link";
import { Card, Empty, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { dubaiDate } from "@/lib/jobs";
import { PO_SELECT, toPo } from "@/lib/parts-data";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const money = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;

/** What was bought from each supplier: LPOs ordered this month, the last three months and all time, with the invoices still to follow or to check. */
export default async function SupplierTotalsPage() {
  await requirePermission("viewPurchaseOrders");
  const admin = createAdminClient();
  const [{ data: rows }, { data: mismatches }] = await Promise.all([
    admin.from("purchase_orders").select(PO_SELECT).eq("is_active", true).in("kind", ["supplier", "stock"]).in("status", ["ordered", "partly_received", "received"]).order("ordered_at", { ascending: false }).limit(2000),
    admin.from("purchase_order_lines").select("po_id").eq("invoice_check", "mismatch").eq("is_active", true),
  ]);
  const pos = ((rows ?? []) as Record<string, unknown>[]).map(toPo);
  const mismatchPo = new Set(((mismatches ?? []) as { po_id: string }[]).map((m) => m.po_id));
  const today = dubaiDate();
  const monthStart = `${today.slice(0, 7)}-01`;
  const threeMonths = (() => { const d = new Date(`${monthStart}T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 2); return d.toISOString().slice(0, 10); })();
  const dayOf = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)) : "");
  type Row = { id: string | null; name: string; count: number; month: number; quarter: number; total: number; last: string | null; toFollow: number; toCheck: number; stockOrders: number };
  const by = new Map<string, Row>();
  for (const p of pos) {
    const key = p.supplier_id ?? `name:${p.supplier_name}`;
    const r = by.get(key) ?? { id: p.supplier_id, name: p.supplier_name, count: 0, month: 0, quarter: 0, total: 0, last: null, toFollow: 0, toCheck: 0, stockOrders: 0 };
    const when = dayOf(p.ordered_at ?? p.created_at);
    r.count++;
    r.total += p.total_cost_aed;
    if (when >= monthStart) r.month += p.total_cost_aed;
    if (when >= threeMonths) r.quarter += p.total_cost_aed;
    if (!r.last || (p.ordered_at ?? p.created_at) > r.last) r.last = p.ordered_at ?? p.created_at;
    if (p.supplier_invoice_status === "to_follow") r.toFollow++;
    if (mismatchPo.has(p.id)) r.toCheck++;
    if (p.kind === "stock") r.stockOrders++;
    by.set(key, r);
  }
  const list = Array.from(by.values()).sort((a, b) => b.quarter - a.quarter || b.total - a.total);
  const sum = (k: "month" | "quarter" | "total") => list.reduce((a, r) => a + r[k], 0);
  return (
    <>
      <PageHeader title="Purchase totals" subtitle={`What was bought from each supplier (before VAT). This month ${money(sum("month"))} · last three months ${money(sum("quarter"))} · all time ${money(sum("total"))}.`} actions={<LinkButton href="/parts/suppliers" tone="secondary" size="lg">Suppliers</LinkButton>} />
      {list.length === 0 ? <Empty title="Nothing ordered yet" /> : null}
      {list.length ? (
        <Card className="flex flex-col gap-2" data-supplier-totals>
          <SectionLabel right={`${list.length} supplier${list.length === 1 ? "" : "s"}`}>By supplier</SectionLabel>
          <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-x-4 gap-y-1 text-sm">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Supplier</span>
            <span className="text-right text-[11px] font-bold uppercase tracking-[0.08em] text-muted">LPOs</span>
            <span className="text-right text-[11px] font-bold uppercase tracking-[0.08em] text-muted">This month</span>
            <span className="text-right text-[11px] font-bold uppercase tracking-[0.08em] text-muted">3 months</span>
            <span className="text-right text-[11px] font-bold uppercase tracking-[0.08em] text-muted">All time</span>
            {list.map((r) => (
              <div key={r.id ?? r.name} className="contents" data-supplier-total={r.name}>
                <span className="flex flex-wrap items-center gap-2 py-1 border-t border-line">
                  <Link href={r.id ? `/parts/orders?supplier=${r.id}` : "/parts/orders"} className="font-semibold underline underline-offset-4">{r.name}</Link>
                  {r.last ? <span className="text-xs text-muted">last order {formatDate(r.last)}</span> : null}
                  {r.stockOrders ? <span className="text-xs text-muted">· {r.stockOrders} stock order{r.stockOrders === 1 ? "" : "s"}</span> : null}
                  {r.toFollow ? <span className="text-xs font-bold text-amber">· {r.toFollow} invoice{r.toFollow === 1 ? "" : "s"} to follow</span> : null}
                  {r.toCheck ? <span className="text-xs font-bold text-red">· {r.toCheck} price{r.toCheck === 1 ? "" : "s"} to check</span> : null}
                </span>
                <span className="py-1 border-t border-line text-right">{r.count}</span>
                <span className="py-1 border-t border-line text-right">{money(r.month)}</span>
                <span className="py-1 border-t border-line text-right">{money(r.quarter)}</span>
                <span className="py-1 border-t border-line text-right font-semibold">{money(r.total)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}

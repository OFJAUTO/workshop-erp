import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { dailyProfit, jobProfits, type JobProfit } from "@/lib/profit";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const aed0 = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;
const n0 = (n: number) => Math.round(n).toLocaleString("en-GB");

type Breakdown = {
  suppliers: { supplier: string; n: number; total: number }[];
  clocked: { name: string; minutes: number }[];
  commissions: { to: string; amount: number; status: string }[];
  trips: { who: string; price: number }[];
};

/** Everything the expanded row shows, loaded once for the whole period (four grouped reads). */
async function loadBreakdowns(jobIds: string[]): Promise<Map<string, Breakdown>> {
  const out = new Map<string, Breakdown>();
  if (!jobIds.length) return out;
  const admin = createAdminClient();
  const [{ data: parts }, { data: sessions }, { data: clockings }, { data: staff }, { data: comms }, { data: trips }] = await Promise.all([
    admin.from("part_items").select("job_id, supplier, cost_aed, final_cost_aed, confirmed_quantity, quantity").in("job_id", jobIds).eq("is_active", true),
    admin.from("work_sessions").select("job_id, staff_id, started_at, ended_at").in("job_id", jobIds),
    admin.from("bodyshop_clockings").select("job_id, staff_id, started_at, ended_at").in("job_id", jobIds),
    admin.from("staff").select("id, display_name"),
    admin.from("quotations").select("job_id, commission_to, commission_aed, commission_status").in("job_id", jobIds).eq("is_active", true).not("commission_to", "is", null).gt("commission_aed", 0),
    admin.from("recovery_trips").select("job_id, driver_name, company, price_aed").in("job_id", jobIds).eq("is_active", true),
  ]);
  const names = new Map(((staff ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  const get = (id: string): Breakdown => {
    if (!out.has(id)) out.set(id, { suppliers: [], clocked: [], commissions: [], trips: [] });
    return out.get(id)!;
  };
  const supplierTotals = new Map<string, Map<string, { n: number; total: number }>>();
  for (const p of (parts ?? []) as { job_id: string; supplier: string | null; cost_aed: number | string | null; final_cost_aed: number | string | null; confirmed_quantity: number | string | null; quantity: number | string }[]) {
    const cost = Number(p.final_cost_aed ?? p.cost_aed) || 0;
    const qty = Number(p.confirmed_quantity ?? p.quantity) || 1;
    if (!(cost > 0)) continue;
    const key = (p.supplier ?? "").trim() || "No supplier";
    const m = supplierTotals.get(p.job_id) ?? new Map();
    const cur = m.get(key) ?? { n: 0, total: 0 };
    cur.n += 1;
    cur.total += cost * qty;
    m.set(key, cur);
    supplierTotals.set(p.job_id, m);
  }
  for (const [jobId, m] of supplierTotals) get(jobId).suppliers = Array.from(m.entries()).map(([supplier, v]) => ({ supplier, ...v })).sort((a, b) => b.total - a.total);
  const minuteRows = [...((sessions ?? []) as { job_id: string; staff_id: string | null; started_at: string; ended_at: string | null }[]), ...((clockings ?? []) as { job_id: string; staff_id: string | null; started_at: string; ended_at: string | null }[])];
  const clockMap = new Map<string, Map<string, number>>();
  for (const s of minuteRows) {
    if (!s.staff_id || !s.ended_at) continue;
    const mins = Math.max(0, (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60000);
    const m = clockMap.get(s.job_id) ?? new Map();
    m.set(s.staff_id, (m.get(s.staff_id) ?? 0) + mins);
    clockMap.set(s.job_id, m);
  }
  for (const [jobId, m] of clockMap) get(jobId).clocked = Array.from(m.entries()).map(([id, minutes]) => ({ name: names.get(id) ?? "?", minutes })).sort((a, b) => b.minutes - a.minutes);
  for (const c of (comms ?? []) as { job_id: string | null; commission_to: string; commission_aed: number | string; commission_status: string | null }[]) {
    if (!c.job_id || c.commission_status === "declined") continue;
    get(c.job_id).commissions.push({ to: c.commission_to, amount: Number(c.commission_aed) || 0, status: c.commission_status ?? "approved" });
  }
  for (const t of (trips ?? []) as { job_id: string | null; driver_name: string | null; company: string | null; price_aed: number | string | null }[]) {
    if (!t.job_id || !(Number(t.price_aed) > 0)) continue;
    get(t.job_id).trips.push({ who: t.company ?? (t.driver_name ? `Our truck · ${t.driver_name}` : "Our truck"), price: Number(t.price_aed) || 0 });
  }
  return out;
}

function periodRange(period: string, from?: string, to?: string): { from: string; to?: string; label: string } {
   
  const now = Date.now();
  const today = new Date(now + 4 * 3600000).toISOString().slice(0, 10);
  const dayStart = (d: string) => new Date(`${d}T00:00:00+04:00`).toISOString();
  if (period === "today") return { from: dayStart(today), label: "Today" };
  if (period === "week") return { from: new Date(now - 7 * 86400000).toISOString(), label: "This week" };
  if (period === "60") return { from: new Date(now - 60 * 86400000).toISOString(), label: "60 days" };
  if (period === "custom" && from) return { from: dayStart(from), to: to ? new Date(`${to}T23:59:59+04:00`).toISOString() : undefined, label: `${from} → ${to ?? "today"}` };
  return { from: dayStart(`${today.slice(0, 7)}-01`), label: "This month" };
}

const SEGMENTS = [
  { key: "parts", label: "Parts", colour: "#2B2B2E" },
  { key: "commission", label: "Commissions", colour: "#4A6FA5" },
  { key: "bank", label: "Bank charges", colour: "#C9A227" },
  { key: "labour", label: "Labour (clocked)", colour: "#7A4AA5" },
  { key: "other", label: "Recovery, materials, other", colour: "#8FA58F" },
  { key: "profit", label: "Profit", colour: "#7FC195" },
] as const;

/**
 * Profit per invoice, the owner's page (1.8, 21 October 2026, built to the agreed mock-up): pure
 * profit after every job cost, the period switch, the four figures, the where-the-money-went bar,
 * and the table with a margin pill per invoice - a row opens into parts per supplier, who clocked,
 * the commission and the recovery. ● provisional = supplier invoices still to come.
 */
export default async function ProfitPage({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; sort?: string; dir?: string; filter?: string }> }) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner") redirect("/dashboard");
  const sp = await searchParams;
  const period = sp.period ?? "month";
  const range = periodRange(period, sp.from, sp.to);
  const settings = await getSettings();
  const [rowsAll, today] = await Promise.all([jobProfits(settings, { from: range.from, to: range.to, limit: 400 }), dailyProfit(settings)]);
  const filter = sp.filter ?? "all";
  const marginOf = (r: JobProfit) => (r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0);
  const rows = rowsAll.filter((r) => (filter === "provisional" ? r.provisional : filter === "low" ? marginOf(r) < 30 : true));
  const sortKey = sp.sort ?? "date";
  const dir = sp.dir === "asc" ? 1 : -1;
  const valueOf = (r: JobProfit): number | string => {
    switch (sortKey) {
      case "revenue": return r.revenue;
      case "parts": return r.partsCost;
      case "labour": return r.labourCost;
      case "other": return r.otherCost + r.stockCost + r.recoveryCost + r.commission + r.materialsCost;
      case "bank": return r.bankCharges;
      case "profit": return r.profit;
      case "margin": return marginOf(r);
      case "invoice": return r.invoice.number;
      default: return r.invoice.issued_at;
    }
  };
  rows.sort((a, b) => (valueOf(a) < valueOf(b) ? -dir : valueOf(a) > valueOf(b) ? dir : 0));
  const sum = (f: (r: JobProfit) => number) => rows.reduce((a, r) => a + f(r), 0);
  const revenue = sum((r) => r.revenue);
  const costs = { parts: sum((r) => r.partsCost), commission: sum((r) => r.commission), bank: sum((r) => r.bankCharges), labour: sum((r) => r.labourCost), other: sum((r) => r.otherCost + r.stockCost + r.recoveryCost + r.materialsCost), profit: sum((r) => r.profit) };
  const jobCosts = revenue - costs.profit;
  const margin = revenue > 0 ? (costs.profit / revenue) * 100 : 0;
  const breakdowns = await loadBreakdowns(Array.from(new Set(rows.map((r) => r.invoice.job_id).filter((x): x is string => !!x))));
  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ period, ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}), sort: sortKey, dir: sp.dir ?? "desc", filter, ...patch });
    return `/profit?${p.toString()}`;
  };
  const sortLink = (key: string) => qs({ sort: key, dir: sortKey === key && sp.dir !== "asc" ? "asc" : "desc" });
  const pill = (m: number) => (m >= 30 ? "bg-green-soft text-green border border-green" : m >= 20 ? "bg-amber-soft text-ink border border-amber-bar" : "bg-white text-red border border-red-bar");
  const monthBehind = today.carry;

  return (
    <>
      <PageHeader
        title="Profit per invoice"
        subtitle={<span>Pure profit after every job cost · <span className="text-amber-bar">●</span> provisional = supplier invoices still to come</span>}
        actions={
          <span className="flex flex-wrap items-center gap-1.5">
            {[["today", "Today"], ["week", "This week"], ["month", "This month"], ["60", "60 days"]].map(([k, l]) => (
              <LinkButton key={k} href={`/profit?period=${k}`} tone={period === k ? "primary" : "secondary"} size="md">{l}</LinkButton>
            ))}
            <details className="relative">
              <summary className={`inline-flex min-h-11 cursor-pointer items-center rounded-control border px-4 text-sm font-bold ${period === "custom" ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>Custom</summary>
              <form className="absolute right-0 z-10 mt-1 flex w-72 flex-col gap-2 rounded-card border border-line bg-white p-3 shadow-xl" action="/profit">
                <input type="hidden" name="period" value="custom" />
                <label className="flex items-center gap-2 text-xs font-semibold">From <input type="date" name="from" defaultValue={sp.from} required className="min-h-10 flex-1 rounded-control border border-line-strong px-2" /></label>
                <label className="flex items-center gap-2 text-xs font-semibold">To <input type="date" name="to" defaultValue={sp.to} className="min-h-10 flex-1 rounded-control border border-line-strong px-2" /></label>
                <button type="submit" className="min-h-10 rounded-control bg-ink text-sm font-bold text-white">Show</button>
              </form>
            </details>
            <a href={`/api/export/profit?from=${encodeURIComponent(range.from)}${range.to ? `&to=${encodeURIComponent(range.to)}` : ""}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-4 text-sm font-bold" data-export-profit>Export to Excel</a>
          </span>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-profit-kpis>
        <Card className="flex flex-col gap-0.5"><span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Revenue (before VAT)</span><span className="text-2xl font-extrabold">{aed0(revenue)}</span><span className="text-xs text-muted">{rows.length} invoice{rows.length === 1 ? "" : "s"} · {range.label}</span></Card>
        <Card className="flex flex-col gap-0.5"><span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Job costs</span><span className="text-2xl font-extrabold">{aed0(jobCosts)}</span><span className="text-xs text-muted">parts, labour, bank, commission…</span></Card>
        <Card className="flex flex-col gap-0.5"><span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Profit</span><span className="text-2xl font-extrabold text-green" data-profit-total>{aed0(costs.profit)}</span><span className="text-xs text-muted">{margin.toFixed(1)}% margin</span></Card>
        <Card className="flex flex-col gap-0.5"><span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Daily target</span><span className="text-2xl font-extrabold">{aed0(today.invoicedProfit)} <span className="text-sm font-semibold text-muted">/ {n0(today.target)} today</span></span><span className="text-xs text-muted">Month: {monthBehind >= 0 ? "ahead" : "behind"} by {aed0(Math.abs(monthBehind))}</span></Card>
      </div>

      <Card className="flex flex-col gap-2" data-money-went>
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">Where the money went</span>
        <div className="flex h-4 w-full overflow-hidden rounded-full bg-chip">
          {SEGMENTS.map((s) => {
            const v = costs[s.key as keyof typeof costs];
            const w = revenue > 0 ? Math.max(0, (v / revenue) * 100) : 0;
            return w > 0.2 ? <span key={s.key} style={{ width: `${w}%`, backgroundColor: s.colour }} title={`${s.label}: ${aed0(v)}`} /> : null;
          })}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold">
          {SEGMENTS.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: s.colour }} />{s.label} {aed0(costs[s.key as keyof typeof costs])}</span>
          ))}
        </div>
      </Card>

      <Card className="p-0 overflow-x-auto" data-profit-table>
        <div className="flex flex-wrap items-center gap-2 px-5 pt-4">
          <span className="text-sm font-extrabold uppercase tracking-[0.08em]">Invoices</span>
          <span className="ml-auto flex gap-1.5 text-xs">
            {[["all", "All"], ["provisional", "Provisional"], ["low", "Low margin"]].map(([k, l]) => (
              <Link key={k} href={qs({ filter: k })} className={`inline-flex min-h-9 items-center rounded-control border px-3 font-bold ${filter === k ? "border-ink bg-ink text-white" : "border-line-strong bg-white"}`}>{l}</Link>
            ))}
          </span>
        </div>
        <table className="w-full min-w-[920px] text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-[0.08em] text-muted">
              {[["invoice", "Invoice", "left"], ["date", "Date", "left"], ["car", "Car", "left"], ["revenue", "Revenue", "right"], ["parts", "Parts", "right"], ["labour", "Labour", "right"], ["other", "Other", "right"], ["bank", "Bank", "right"], ["profit", "Profit", "right"], ["margin", "Margin", "right"]].map(([k, l, align]) => (
                <th key={k} className={`px-3 py-2 font-bold ${align === "right" ? "text-right" : "text-left"} ${k === "invoice" ? "pl-5" : ""}`}>
                  {k === "car" ? l : <Link href={sortLink(k)} className="underline-offset-4 hover:underline">{l}{sortKey === k ? (sp.dir === "asc" ? " ↑" : " ↓") : ""}</Link>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const other = r.otherCost + r.stockCost + r.recoveryCost + r.commission + r.materialsCost;
              const m = marginOf(r);
              const b = r.invoice.job_id ? breakdowns.get(r.invoice.job_id) : undefined;
              return (
                <tr key={r.invoice.id} data-profit-row={r.invoice.number}>
                  <td className="px-3 py-2 pl-5 align-top font-extrabold"><Link href={`/invoices/${r.invoice.id}`} className="underline underline-offset-4">{r.invoice.number}</Link></td>
                  <td className="px-3 py-2 align-top text-muted whitespace-nowrap">{formatDate(r.invoice.issued_at)}</td>
                  <td className="px-3 py-2 align-top">
                    <details>
                      <summary className="cursor-pointer list-none font-semibold uppercase">
                        {r.plate ?? ""} <span className="text-muted normal-case">· {r.jobNumber ?? ""}</span>
                        {r.provisional ? <span className="ml-1 text-amber-bar" title={`Provisional: ${r.provisionalWhy.join(", ")}`} data-provisional-dot>●</span> : null}
                      </summary>
                      <div className="mt-2 flex flex-col gap-1 rounded-control bg-canvas p-2 text-xs normal-case" data-profit-breakdown>
                        {b?.suppliers.length ? <span><span className="font-bold">Parts:</span> {b.suppliers.map((s) => `${s.supplier} ${aed0(s.total)} (${s.n})`).join(" · ")}</span> : null}
                        {b?.clocked.length ? <span><span className="font-bold">Clocked:</span> {b.clocked.map((c) => `${c.name} ${(c.minutes / 60).toFixed(1)} h`).join(" · ")}</span> : null}
                        {b?.commissions.length ? <span><span className="font-bold">Commission:</span> {b.commissions.map((c) => `${c.to} ${aed0(c.amount)}${c.status === "pending" ? " (pending)" : ""}`).join(" · ")}</span> : null}
                        {b?.trips.length ? <span><span className="font-bold">Recovery:</span> {b.trips.map((t) => `${t.who} ${aed0(t.price)}`).join(" · ")}</span> : null}
                        {r.provisional ? <span className="text-amber-bar">Provisional: {r.provisionalWhy.join(", ")}</span> : null}
                        {!b || (!b.suppliers.length && !b.clocked.length && !b.commissions.length && !b.trips.length) ? <span className="text-muted">No parts, clockings, commission or recovery on this job.</span> : null}
                      </div>
                    </details>
                  </td>
                  <td className="px-3 py-2 align-top text-right">{n0(r.revenue)}</td>
                  <td className="px-3 py-2 align-top text-right">{n0(r.partsCost)}</td>
                  <td className="px-3 py-2 align-top text-right whitespace-nowrap">{n0(r.labourCost)} <span className="text-xs text-muted">({(r.labourMinutes / 60).toFixed(1)} h)</span></td>
                  <td className="px-3 py-2 align-top text-right">{n0(other)}</td>
                  <td className="px-3 py-2 align-top text-right">{n0(r.bankCharges)}</td>
                  <td className={`px-3 py-2 align-top text-right font-extrabold ${r.profit < 0 ? "text-red" : ""}`}>{n0(r.profit)}</td>
                  <td className="px-3 py-2 align-top text-right"><span className={`inline-flex min-h-6 items-center rounded-full px-2 text-xs font-bold ${pill(m)}`} data-margin-pill>{m.toFixed(1)}%</span></td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-ink font-extrabold" data-profit-total-row>
              <td className="px-3 py-2.5 pl-5">Total</td>
              <td className="px-3 py-2.5" />
              <td className="px-3 py-2.5">{rows.length} invoice{rows.length === 1 ? "" : "s"}</td>
              <td className="px-3 py-2.5 text-right">{n0(revenue)}</td>
              <td className="px-3 py-2.5 text-right">{n0(costs.parts)}</td>
              <td className="px-3 py-2.5 text-right">{n0(costs.labour)}</td>
              <td className="px-3 py-2.5 text-right">{n0(sum((r) => r.otherCost + r.stockCost + r.recoveryCost + r.commission + r.materialsCost))}</td>
              <td className="px-3 py-2.5 text-right">{n0(costs.bank)}</td>
              <td className="px-3 py-2.5 text-right">{n0(costs.profit)}</td>
              <td className="px-3 py-2.5 text-right"><span className={`inline-flex min-h-6 items-center rounded-full px-2 text-xs font-bold ${pill(margin)}`}>{margin.toFixed(1)}%</span></td>
            </tr>
          </tbody>
        </table>
        <p className="px-5 pb-4 pt-2 text-xs text-muted">Tap a row&apos;s car for the full breakdown (parts per supplier, who clocked, commission, recovery). Margin: green ≥30% · amber 20–30% · red &lt;20%.</p>
      </Card>
    </>
  );
}

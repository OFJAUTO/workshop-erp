import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Button, Card, Empty, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDate, formatDateTime } from "@/lib/format";
import { PO_SELECT, PO_STATUS_LABELS, toPo, type PurchaseOrderRow } from "@/lib/parts-data";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Days since a moment, and today's date; outside the page so the render stays free of clock calls. */
const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);
const todayIso = () => new Date().toISOString().slice(0, 10);
const ago = (iso: string) => { const d = daysSince(iso); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };

type JobInfo = { id: string; job_number: string; is_open: boolean; vehicle: { kind?: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; customer: { full_name: string; company_name: string | null } | null };
type LineInfo = { po_id: string; description: string; part_number: string | null; expected_date: string | null; quantity: number | string; received_qty: number | string; invoice_check: string | null };

const ORDER_TYPE_LABELS: Record<"stock_parts" | "consumables" | "tools", string> = { stock_parts: "Stock parts", consumables: "Workshop consumables", tools: "Tools and equipment" };

const TABS = [
  { key: "", label: "All" },
  { key: "pending", label: "Waiting for approval" },
  { key: "to_send", label: "Approved, to send" },
  { key: "ordered", label: "Ordered" },
  { key: "received", label: "Received" },
  { key: "invoices", label: "Supplier invoices" },
  { key: "stock", label: "Stock orders" },
  { key: "cancelled", label: "Cancelled" },
] as const;

/**
 * LPOs: one list with status tabs, a search by plate, VIN, job number, part or LPO number (the cars found get their
 * own "LPOs for this car" sections), a supplier filter, quick dates, late orders in red, stock orders marked, the
 * main LPO linked from its supplier LPOs, cancelled ones kept.
 */
export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; tab?: string; q?: string; supplier?: string }> }) {
  await requirePermission("viewPurchaseOrders");
  const { message, error, tab = "", q = "", supplier = "" } = await searchParams;
  const settings = await getSettings();
  const admin = createAdminClient();
  const { data } = await admin.from("purchase_orders").select(PO_SELECT).eq("is_active", true).order("created_at", { ascending: false }).limit(600);
  const all = ((data ?? []) as Record<string, unknown>[]).map(toPo);
  const jobIds = Array.from(new Set(all.map((p) => p.job_id).filter((x): x is string => !!x)));
  const [{ data: jobs }, { data: lines }] = await Promise.all([
    jobIds.length ? admin.from("jobs").select("id, job_number, is_open, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), customer:customers(full_name, company_name)").in("id", jobIds) : Promise.resolve({ data: [] }),
    all.length ? admin.from("purchase_order_lines").select("po_id, description, part_number, expected_date, quantity, received_qty, invoice_check").in("po_id", all.map((p) => p.id)).eq("is_active", true) : Promise.resolve({ data: [] }),
  ]);
  const jobOf = new Map(((jobs ?? []) as unknown as JobInfo[]).map((j) => [j.id, j]));
  const linesOf = (id: string) => ((lines ?? []) as LineInfo[]).filter((l) => l.po_id === id);
  const today = todayIso();
  const redDays = Number(settings.supplier_invoice_pending_red_days) || 7;
  const lateOf = (po: PurchaseOrderRow) => linesOf(po.id).filter((l) => l.expected_date && l.expected_date < today && Number(l.received_qty) < Number(l.quantity)).length;
  const mismatchOf = (po: PurchaseOrderRow) => linesOf(po.id).filter((l) => l.invoice_check === "mismatch").length;
  const numberOf = new Map(all.map((p) => [p.id, p.number]));
  // A main LPO shows while it waits or when refused; once approved its supplier LPOs carry the state.
  const visible = all.filter((p) => p.kind !== "main" || p.status === "pending_approval" || p.status === "cancelled");
  const needle = q.trim().toLowerCase();
  const carLine = (po: PurchaseOrderRow) => {
    const j = po.job_id ? jobOf.get(po.job_id) : null;
    return j ? { plate: j.vehicle ? formatPlate(j.vehicle) : "", car: [j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" "), job: j.job_number, vin: j.vehicle?.vin ?? "", customer: j.customer?.company_name ?? j.customer?.full_name ?? "", open: j.is_open } : null;
  };
  const matches = (po: PurchaseOrderRow) => {
    if (!needle) return true;
    const c = carLine(po);
    const hay = [po.number, po.supplier_name, c?.plate, c?.car, c?.job, c?.vin, c?.customer, ...linesOf(po.id).flatMap((l) => [l.description, l.part_number ?? ""])].join(" ").toLowerCase();
    return hay.includes(needle);
  };
  const inTab = (po: PurchaseOrderRow) => {
    switch (tab) {
      case "pending": return po.status === "pending_approval";
      case "to_send": return po.status === "approved";
      case "ordered": return po.status === "ordered" || po.status === "partly_received";
      case "received": return po.status === "received";
      case "invoices": return po.status !== "cancelled" && po.status !== "pending_approval" && (po.supplier_invoice_status === "to_follow" || mismatchOf(po) > 0);
      case "stock": return po.kind === "stock";
      case "cancelled": return po.status === "cancelled";
      default: return true;
    }
  };
  const searched = visible.filter(matches).filter((po) => !supplier || po.supplier_id === supplier);
  const counts = Object.fromEntries(TABS.map((t) => [t.key, searched.filter((po) => (t.key ? inTab({ ...po } as PurchaseOrderRow) : true)).length]));
  const shown = searched.filter(inTab);
  const suppliers = Array.from(new Map(visible.filter((p) => p.supplier_id).map((p) => [p.supplier_id as string, p.supplier_name])).entries());
  const keep = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, q, supplier, ...next })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/parts/orders?${s}` : "/parts/orders";
  };
  // With a search that finds cars, the LPOs are grouped per car.
  const groups: { key: string; title: string; items: PurchaseOrderRow[] }[] = [];
  if (needle) {
    const byJob = new Map<string, PurchaseOrderRow[]>();
    for (const po of shown) byJob.set(po.job_id ?? "stock", [...(byJob.get(po.job_id ?? "stock") ?? []), po]);
    for (const [jobId, items] of byJob) {
      const c = carLine(items[0]);
      groups.push({ key: jobId, title: c ? `LPOs for this car: ${c.plate} · ${c.car} · ${c.job}${c.open ? "" : " · gated out"}` : "Stock orders", items });
    }
  } else if (tab === "invoices") {
    // Accounts see the supplier bills by kind of goods.
    const kindOf = (po: PurchaseOrderRow) => (po.job_id ? "job" : (po.order_type ?? "stock_parts"));
    for (const k of ["job", "stock_parts", "consumables", "tools"] as const) {
      const items = shown.filter((po) => kindOf(po) === k);
      if (items.length) groups.push({ key: k, title: k === "job" ? "Parts for jobs" : ORDER_TYPE_LABELS[k], items });
    }
  } else {
    groups.push({ key: "all", title: TABS.find((t) => t.key === tab)?.label ?? "All", items: shown });
  }
  const tone = (p: PurchaseOrderRow): "neutral" | "amber" | "green" | "red" | "ink" => (p.status === "pending_approval" ? "amber" : p.status === "received" ? "green" : p.status === "cancelled" ? "neutral" : "ink");

  return (
    <>
      <LiveRefresh tables={["purchase_orders"]} pollMs={60000} />
      <PageHeader title="LPOs" subtitle="Raised from the Parts desk or the stock page, approved by the owner or the head accountant, sent to the supplier, received line by line." actions={<LinkButton href="/parts" tone="secondary" size="lg">Parts desk</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card className="flex flex-col gap-3">
        <form method="get" action="/parts/orders" className="flex flex-wrap items-end gap-2">
          {tab ? <input type="hidden" name="tab" value={tab} /> : null}
          {supplier ? <input type="hidden" name="supplier" value={supplier} /> : null}
          <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Search<Input name="q" defaultValue={q} placeholder="Plate, VIN, job number, part or LPO number" className="w-80" data-lpo-search /></label>
          <Button type="submit" size="md" tone="secondary">Find</Button>
          {q ? <Link href={keep({ q: "" })} className="min-h-11 inline-flex items-center text-sm font-bold underline underline-offset-4">Clear</Link> : null}
        </form>
        <div className="flex flex-wrap gap-1 text-xs font-bold" data-lpo-tabs>
          {TABS.map((t) => (
            <Link key={t.key} href={keep({ tab: t.key })} className={`min-h-9 inline-flex items-center rounded-control px-3 ${tab === t.key ? "bg-ink text-white" : "bg-chip"}`} data-lpo-tab={t.key}>{t.label} · {counts[t.key]}</Link>
          ))}
        </div>
        {suppliers.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1 text-xs font-bold" data-lpo-suppliers>
            <span className="text-muted mr-1">Supplier:</span>
            <Link href={keep({ supplier: "" })} className={`min-h-9 inline-flex items-center rounded-control px-3 ${!supplier ? "bg-ink text-white" : "bg-chip"}`}>All</Link>
            {suppliers.map(([id, name]) => <Link key={id} href={keep({ supplier: id })} className={`min-h-9 inline-flex items-center rounded-control px-3 ${supplier === id ? "bg-ink text-white" : "bg-chip"}`}>{name}</Link>)}
          </div>
        ) : null}
      </Card>
      {shown.length === 0 ? <Empty title={needle ? "Nothing found" : "No LPOs here"} /> : null}
      {groups.map((g) =>
        g.items.length ? (
          <section key={g.key} className="flex flex-col gap-3" data-lpo-group={g.key}>
            <SectionLabel right={`${g.items.length}`}>{g.title}</SectionLabel>
            {g.key === "all" && tab === "invoices" ? <p className="text-xs text-muted">Invoices to follow turn red after {redDays} days; a price more than AED 1 off the LPO waits for Accept new price or Dispute. The job&apos;s profit stays provisional meanwhile.</p> : null}
            {g.items.map((p) => {
              const late = lateOf(p);
              const mismatch = mismatchOf(p);
              const invoiceAge = p.supplier_invoice_status === "to_follow" ? daysSince(p.received_at ?? p.ordered_at ?? p.created_at) : 0;
              const red = (late > 0 && p.status !== "cancelled") || invoiceAge >= redDays || mismatch > 0;
              const c = carLine(p);
              const expected = linesOf(p.id).map((l) => l.expected_date).filter((d): d is string => !!d).sort().at(-1) ?? null;
              return (
                <Link key={p.id} href={`/parts/orders/${p.id}`} className="block" data-lpo-row={p.number}>
                  <Card className={`flex flex-wrap items-center gap-3 hover:border-ink ${red ? "border-red-bar" : ""}`}>
                    <span className="font-extrabold">{p.number}</span>
                    {p.kind === "stock" ? <Badge tone="ink">{ORDER_TYPE_LABELS[p.order_type ?? "stock_parts"]}</Badge> : null}
                    {p.fixed_asset ? <Badge tone="red">Fixed asset</Badge> : null}
                    {p.parent_id && numberOf.get(p.parent_id) ? <span className="text-xs text-muted">from {numberOf.get(p.parent_id)}</span> : null}
                    <span className="font-semibold">{p.supplier_name}</span>
                    {c ? <span className="text-sm text-muted">{c.plate} · {c.car} · {c.job}</span> : p.kind === "stock" ? <span className="text-sm text-muted">for the shelf</span> : null}
                    <Badge tone={tone(p)}>{PO_STATUS_LABELS[p.status]}</Badge>
                    {late && p.status !== "cancelled" ? <Badge tone="red">{late} line{late === 1 ? "" : "s"} late</Badge> : null}
                    {p.supplier_invoice_status === "to_follow" ? <Badge tone={invoiceAge >= redDays ? "red" : "amber"}>Invoice to follow · {invoiceAge} day{invoiceAge === 1 ? "" : "s"}</Badge> : null}
                    {mismatch ? <Badge tone="red">{mismatch} price{mismatch === 1 ? "" : "s"} to check</Badge> : null}
                    {p.emailed_at ? <Badge tone="green">Emailed</Badge> : p.sent_at ? <Badge tone="green">Sent</Badge> : null}
                    <span className="ml-auto text-sm font-semibold">AED {p.total_cost_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
                    <span className="text-xs text-muted">{p.status === "received" && p.received_at ? `received ${ago(p.received_at)}` : p.ordered_at ? `ordered ${ago(p.ordered_at)}${expected && p.status !== "received" ? `, expected ${formatDate(expected)}` : ""}` : `raised ${formatDateTime(p.created_at)}`}</span>
                  </Card>
                </Link>
              );
            })}
          </section>
        ) : null,
      )}
    </>
  );
}

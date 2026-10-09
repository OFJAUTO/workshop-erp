import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
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

type JobInfo = { id: string; job_number: string; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null };

/** Purchase orders: waiting for approval, approved and not sent, ordered (late ones flagged), received, and supplier invoices still to follow. */
export default async function PurchaseOrdersPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("viewPurchaseOrders");
  const { message, error } = await searchParams;
  const settings = await getSettings();
  const admin = createAdminClient();
  const { data } = await admin.from("purchase_orders").select(PO_SELECT).eq("is_active", true).order("created_at", { ascending: false }).limit(300);
  const pos = ((data ?? []) as Record<string, unknown>[]).map(toPo);
  const jobIds = Array.from(new Set(pos.map((p) => p.job_id)));
  const [{ data: jobs }, { data: lines }] = await Promise.all([
    jobIds.length ? admin.from("jobs").select("id, job_number, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))").in("id", jobIds) : Promise.resolve({ data: [] }),
    pos.length ? admin.from("purchase_order_lines").select("po_id, expected_date, quantity, received_qty").in("po_id", pos.map((p) => p.id)).eq("is_active", true) : Promise.resolve({ data: [] }),
  ]);
  const jobOf = new Map(((jobs ?? []) as unknown as JobInfo[]).map((j) => [j.id, j]));
  const today = todayIso();
  const redDays = Number(settings.supplier_invoice_pending_red_days) || 7;
  const lateOf = (po: PurchaseOrderRow) => ((lines ?? []) as { po_id: string; expected_date: string | null; quantity: number; received_qty: number }[]).filter((l) => l.po_id === po.id && l.expected_date && l.expected_date < today && Number(l.received_qty) < Number(l.quantity)).length;
  const jobLine = (id: string) => {
    const j = jobOf.get(id);
    return j ? `${j.vehicle ? formatPlate(j.vehicle) : ""} · ${[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · ${j.job_number}` : "";
  };
  const groups: { key: string; title: string; items: PurchaseOrderRow[]; hint?: string }[] = [
    { key: "pending", title: "Waiting for approval", items: pos.filter((p) => p.status === "pending_approval"), hint: "Only the owner or the head accountant can approve. A PO cannot be sent before approval." },
    { key: "approved", title: "Approved, to send", items: pos.filter((p) => p.status === "approved") },
    { key: "ordered", title: "Ordered, waiting for delivery", items: pos.filter((p) => p.status === "ordered" || p.status === "partly_received") },
    { key: "invoices", title: "Supplier invoices to follow", items: pos.filter((p) => p.status !== "cancelled" && p.status !== "pending_approval" && p.supplier_invoice_status === "to_follow"), hint: `Red after ${redDays} days. The job's profit stays provisional until the invoice is in.` },
    { key: "received", title: "Received", items: pos.filter((p) => p.status === "received" && p.supplier_invoice_status === "received").slice(0, 30) },
    { key: "cancelled", title: "Refused or cancelled", items: pos.filter((p) => p.status === "cancelled").slice(0, 20) },
  ];
  const tone = (p: PurchaseOrderRow): "neutral" | "amber" | "green" | "red" | "ink" => (p.status === "pending_approval" ? "amber" : p.status === "received" ? "green" : p.status === "cancelled" ? "neutral" : "ink");
  const ageDays = daysSince;

  return (
    <>
      <LiveRefresh tables={["purchase_orders"]} pollMs={60000} />
      <PageHeader title="Purchase orders" subtitle="Raised from the Parts desk, approved by the owner or the head accountant, sent to the supplier, received line by line." actions={<LinkButton href="/parts" tone="secondary" size="lg">Parts desk</LinkButton>} />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {pos.length === 0 ? <Empty title="No purchase orders yet" /> : null}
      {groups.map((g) =>
        g.items.length ? (
          <section key={g.key} className="flex flex-col gap-3">
            <SectionLabel right={`${g.items.length}`}>{g.title}</SectionLabel>
            {g.hint ? <p className="text-xs text-muted">{g.hint}</p> : null}
            {g.items.map((p) => {
              const late = lateOf(p);
              const invoiceAge = g.key === "invoices" ? ageDays(p.received_at ?? p.ordered_at ?? p.created_at) : 0;
              const red = late > 0 || (g.key === "invoices" && invoiceAge >= redDays);
              return (
                <Link key={p.id} href={`/parts/orders/${p.id}`} className="block">
                  <Card className={`flex flex-wrap items-center gap-3 hover:border-ink ${red ? "border-red-bar" : ""}`}>
                    <span className="font-extrabold">{p.number}</span>
                    <span className="font-semibold">{p.supplier_name}</span>
                    <span className="text-sm text-muted">{jobLine(p.job_id)}</span>
                    <Badge tone={tone(p)}>{PO_STATUS_LABELS[p.status]}</Badge>
                    {late ? <Badge tone="red">{late} line{late === 1 ? "" : "s"} late</Badge> : null}
                    {g.key === "invoices" ? <Badge tone={invoiceAge >= redDays ? "red" : "amber"}>Invoice pending {invoiceAge} day{invoiceAge === 1 ? "" : "s"}</Badge> : null}
                    <span className="ml-auto text-sm font-semibold">AED {p.total_cost_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
                    <span className="text-xs text-muted">{p.ordered_at ? `ordered ${formatDate(p.ordered_at)}` : `raised ${formatDateTime(p.created_at)}`}</span>
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

import Link from "next/link";
import { Card, Empty, PageHeader, SectionLabel } from "@/components/ui";
import { WaitingPanel } from "@/components/WaitingPanel";
import { PartsSteps } from "@/components/PartsSteps";
import type { CurrentStaff } from "@/lib/auth";
import { partsSteps, stepPartOf, type PartsStepKey } from "@/lib/parts-steps";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";

/** The one thing to do next on a car's parts, per current step. */
const STEP_ACTIONS: Record<PartsStepKey, { label: string; href: (jobId: string) => string }> = {
  pricing: { label: "Price the parts", href: (id) => `/parts/${id}#pricing` },
  approval: { label: "Send the LPO for approval", href: (id) => `/parts/${id}#lpo` },
  lpo: { label: "Order from the supplier", href: (id) => `/parts/${id}#lpos` },
  received: { label: "Receive the parts", href: (id) => `/parts/${id}#received` },
  handover: { label: "Hand over", href: (id) => `/parts/handover/${id}` },
};

/**
 * The Parts role's dashboard: no workshop chips, only parts. Tiles with counts (to price, LPOs waiting, to order,
 * arriving today, overdue, received not handed over, supplier invoices missing), then the cars with parts activity,
 * each with the five step dots and the one button for its current step. "Waiting on you" stays at the top.
 */
export async function PartsDashboard({ staff }: { staff: CurrentStaff }) {
  const admin = createAdminClient();
  // eslint-disable-next-line react-hooks/purity -- a server page: today is read once per request
  const today = new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
  const [{ data: reqRows }, { data: partRows }, { data: poRows }] = await Promise.all([
    admin.from("part_requests").select("id, job_id, status").eq("is_active", true).eq("status", "open"),
    admin.from("part_items").select("id, job_id, is_active, order_status, received_qty, quantity, confirmed_quantity, issue_status, availability, supplier, po_id, return_status, cost_aed, confirm_status, expected_date").eq("is_active", true),
    admin.from("purchase_orders").select("id, kind, status, supplier_invoice_status").eq("is_active", true),
  ]);
  const requests = (reqRows ?? []) as { id: string; job_id: string; status: string }[];
  const parts = (partRows ?? []) as { id: string; job_id: string; is_active: boolean; order_status: string | null; received_qty: number | string; quantity: number | string; confirmed_quantity: number | string | null; issue_status: string | null; availability: string | null; supplier: string | null; po_id: string | null; return_status: string | null; cost_aed: number | string | null; confirm_status: string | null; expected_date: string | null }[];
  const pos = (poRows ?? []) as { id: string; kind: string; status: string; supplier_invoice_status: string | null }[];
  const jobIds = Array.from(new Set([...requests.map((r) => r.job_id), ...parts.map((p) => p.job_id)].filter(Boolean)));
  const { data: jobRows } = jobIds.length ? await admin.from("jobs").select("id, job_number, status, is_open, gated_in_at, parts_pricing_done_at, parts_pricing_reopened_at, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, make:vehicle_makes(name), model:vehicle_models(name))").in("id", jobIds).eq("is_open", true).order("gated_in_at", { ascending: false }) : { data: [] };
  type JobRow = { id: string; job_number: string; status: string; gated_in_at: string; parts_pricing_done_at: string | null; parts_pricing_reopened_at: string | null; vehicle: (Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null }) | null };
  const jobs = ((jobRows ?? []) as unknown as JobRow[]);
  const open = new Set(jobs.map((j) => j.id));
  const openParts = parts.filter((p) => open.has(p.job_id));
  const unreceived = (p: (typeof parts)[number]) => Number(p.received_qty) < Number(p.confirmed_quantity ?? p.quantity);

  const tiles: { key: string; label: string; count: number; href: string }[] = [
    { key: "to-price", label: "To price", count: requests.filter((r) => open.has(r.job_id)).length + openParts.filter((p) => p.cost_aed === null && p.confirm_status !== "rejected" && !p.return_status?.includes("removed")).length, href: "/parts" },
    { key: "lpo-approval", label: "LPOs waiting for approval", count: pos.filter((p) => p.status === "pending_approval").length, href: "/parts/orders" },
    { key: "to-order", label: "To order (send to supplier)", count: pos.filter((p) => (p.kind === "supplier" || p.kind === "stock") && p.status === "approved").length, href: "/parts/orders" },
    { key: "arriving", label: "Arriving today", count: openParts.filter((p) => p.expected_date === today && unreceived(p)).length, href: "/parts/arrivals" },
    { key: "overdue", label: "Overdue deliveries", count: openParts.filter((p) => !!p.expected_date && p.expected_date < today && unreceived(p) && ["ordered", "partly_received"].includes(p.order_status ?? "")).length, href: "/parts/arrivals" },
    { key: "to-handover", label: "Received, not handed over", count: openParts.filter((p) => p.order_status === "received" && p.issue_status !== "confirmed" && (p.return_status ?? "none") === "none").length, href: "/parts" },
    { key: "invoices-missing", label: "Supplier invoices missing", count: pos.filter((p) => p.supplier_invoice_status === "to_follow").length, href: "/parts/orders?tab=invoices" },
  ];

  return (
    <>
      <PageHeader title="Parts" subtitle="Your day at a glance: what to price, approve, order, receive and hand over." />
      <WaitingPanel staff={staff} />
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-7 gap-3" data-parts-tiles>
        {tiles.map((t) => (
          <Link key={t.key} href={t.href} className={`flex min-h-20 flex-col justify-center rounded-card border px-4 py-3 ${t.count ? "border-ink bg-white" : "border-line bg-white"}`} data-parts-tile={t.key}>
            <span className="text-2xl font-extrabold">{t.count}</span>
            <span className="text-xs font-semibold text-muted">{t.label}</span>
          </Link>
        ))}
      </div>
      <Card className="flex flex-col gap-2" data-parts-cars>
        <SectionLabel right={`${jobs.length}`}>Cars with parts</SectionLabel>
        {jobs.length === 0 ? <Empty title="No open car has parts" /> : (
          <ul className="flex flex-col divide-y divide-line">
            {jobs.map((j) => {
              const steps = partsSteps({ jobStatus: j.status, pricingDoneAt: j.parts_pricing_done_at, pricingReopenedAt: j.parts_pricing_reopened_at, parts: parts.filter((p) => p.job_id === j.id).map((p) => stepPartOf(p)) });
              const current = steps.find((s) => s.state === "current");
              const action = current ? STEP_ACTIONS[current.key] : null;
              const allDone = steps.every((s) => s.state === "done");
              return (
                <li key={j.id} className="py-2.5 flex flex-wrap items-center gap-3" data-parts-car={j.id}>
                  <Link href={`/parts/${j.id}`} className="font-bold underline underline-offset-4">
                    {j.vehicle ? formatPlate(j.vehicle) : j.job_number}
                  </Link>
                  <span className="text-sm text-muted">{[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · {j.job_number}</span>
                  <PartsSteps steps={steps} size="dots" />
                  <span className="ml-auto">
                    {allDone ? <span className="text-xs font-bold text-green" data-parts-done>All done</span> : action ? (
                      <Link href={action.href(j.id)} className="inline-flex min-h-10 items-center rounded-control bg-ink px-3.5 text-sm font-bold text-white" data-parts-action={current?.key}>
                        {action.label}
                      </Link>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}

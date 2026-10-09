import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Button, Card, Empty, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { formatWait, workingMinutesSince, workingTimeOf } from "@/lib/jobs";
import { REQUEST_SELECT } from "@/lib/quote-data";
import { PART_FULL_SELECT, toPartFull } from "@/lib/parts-data";
import { AVAILABILITY_LABELS, type PartRequest } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { createPurchaseOrder } from "./order-actions";

export const dynamic = "force-dynamic";

const todayIso = () => new Date().toISOString().slice(0, 10);

type JobInfo = { id: string; job_number: string; is_open: boolean; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; assignee: { display_name: string } | null };

/** The Parts role's desk: price requests from inspections, parts waiting for prices or the technician, and approved parts to order. */
export default async function PartsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("priceParts");
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const wt = workingTimeOf(settings);
  const target = Number(settings.parts_pricing_target_hours) || 4;
  const [{ data: reqRows }, { data: partRows }, { data: supplierRows }] = await Promise.all([
    admin.from("part_requests").select(REQUEST_SELECT).eq("is_active", true).in("status", ["open", "listed"]).order("created_at"),
    admin.from("part_items").select(PART_FULL_SELECT).eq("is_active", true).order("created_at"),
    admin.from("suppliers").select("name").eq("is_active", true).order("name"),
  ]);
  const requests = (reqRows ?? []) as PartRequest[];
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull).map((p) => ({ ...p, advisor_added_label: p.added_by_role === "service_advisor" && !p.part_request_id ? "Added by advisor" : null }));
  const supplierNames = Array.from(new Set([...(supplierRows ?? []).map((s) => s.name as string), ...parts.map((p) => p.supplier).filter((x): x is string => !!x)])).sort();
  const today = todayIso();
  const jobIds = Array.from(new Set([...requests.map((r) => r.job_id), ...parts.map((p) => p.job_id)]));
  const { data: jobRows } = jobIds.length ? await admin.from("jobs").select("id, job_number, is_open, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name)").in("id", jobIds) : { data: [] };
  const jobs = new Map(((jobRows ?? []) as unknown as JobInfo[]).filter((j) => j.is_open).map((j) => [j.id, j]));
  const jobLine = (id: string) => {
    const j = jobs.get(id);
    if (!j) return null;
    return `${j.vehicle ? formatPlate(j.vehicle) : ""} · ${[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · ${j.job_number}${j.assignee ? ` · ${j.assignee.display_name}` : ""}`;
  };
  const tone = (sinceIso: string) => {
    const min = workingMinutesSince(sinceIso, wt);
    return { min, tone: min >= target * 120 ? "red" : min >= target * 60 ? "amber" : "neutral" } as const;
  };

  const toPrice = requests.filter((r) => jobs.has(r.job_id) && r.status === "open");
  const waitingPrice = parts.filter((p) => jobs.has(p.job_id) && p.cost_aed === null && p.confirm_status !== "rejected");
  const waitingTech = parts.filter((p) => jobs.has(p.job_id) && p.confirm_status === "pending");
  const toOrder = parts.filter((p) => jobs.has(p.job_id) && p.order_status === "to_order" && !p.po_id);
  const ordered = parts.filter((p) => jobs.has(p.job_id) && ((p.order_status === "to_order" && !!p.po_id) || p.order_status === "ordered" || p.order_status === "partly_received"));
  const toIssue = parts.filter((p) => jobs.has(p.job_id) && p.order_status === "received" && p.issue_status !== "confirmed" && p.return_status === "none");
  const byJob = (items: { job_id: string }[]) => Array.from(new Set(items.map((i) => i.job_id)));

  return (
    <>
      <LiveRefresh tables={["part_requests", "part_items", "jobs"]} pollMs={60000} />
      <PageHeader title="Parts" subtitle="Price requests from inspections, exact parts, and approved parts to order." />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <section className="flex flex-col gap-3">
        <SectionLabel right={`${toPrice.length}`}>Price requests</SectionLabel>
        <p className="text-xs text-muted">What the technician asked for on the report. Turn each into exact parts with a part number, description and quantity. Target: {target} working hours, amber past it, red at double.</p>
        {toPrice.length === 0 ? <Empty title="No requests waiting" /> : null}
        {byJob(toPrice).map((jobId) => {
          const rows = toPrice.filter((r) => r.job_id === jobId);
          const oldest = rows.reduce((a, r) => (r.created_at < a ? r.created_at : a), rows[0].created_at);
          const t = tone(oldest);
          return (
            <Card key={jobId} className={`flex flex-col gap-2 ${t.tone === "red" ? "border-red-bar" : t.tone === "amber" ? "border-amber-bar" : ""}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>
                <span className="flex items-center gap-2">
                  <Badge tone={t.tone}>{formatWait(t.min, wt)} waiting</Badge>
                  <LinkButton href={`/parts/${jobId}`} size="md">Open</LinkButton>
                </span>
              </div>
              <ul className="text-sm divide-y divide-line">
                {rows.map((r) => (
                  <li key={r.id} className="py-1.5"><span className="font-semibold">{r.label}</span>{r.requested_text ? <span className="text-muted"> · {r.requested_text}</span> : null}</li>
                ))}
              </ul>
            </Card>
          );
        })}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="flex flex-col gap-3">
          <SectionLabel right={`${waitingPrice.length}`}>Waiting for a price</SectionLabel>
          {waitingPrice.length === 0 ? <p className="text-sm text-muted">None.</p> : null}
          {byJob(waitingPrice).map((jobId) => (
            <Card key={jobId} className="flex flex-col gap-1">
              <Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>
              <ul className="text-sm divide-y divide-line">
                {waitingPrice.filter((p) => p.job_id === jobId).map((p) => (
                  <li key={p.id} className="py-1.5">{p.description}{p.part_number ? <span className="text-muted"> · {p.part_number}</span> : null} · × {p.confirmed_quantity ?? p.quantity}</li>
                ))}
              </ul>
            </Card>
          ))}
        </section>
        <section className="flex flex-col gap-3">
          <SectionLabel right={`${waitingTech.length}`}>Waiting for the technician</SectionLabel>
          {waitingTech.length === 0 ? <p className="text-sm text-muted">None.</p> : null}
          {byJob(waitingTech).map((jobId) => (
            <Card key={jobId} className="flex flex-col gap-1">
              <Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>
              <ul className="text-sm divide-y divide-line">
                {waitingTech.filter((p) => p.job_id === jobId).map((p) => (
                  <li key={p.id} className="py-1.5">{p.description} · × {p.quantity} · listed {formatDateTime(p.created_at)}</li>
                ))}
              </ul>
            </Card>
          ))}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <SectionLabel right={`${toOrder.length}`}>To order (approved by the customer)</SectionLabel>
        <p className="text-xs text-muted">Tick the parts for one supplier and raise a purchase order. It goes to the owner or the head accountant for approval; it cannot be sent before that.</p>
        {toOrder.length === 0 ? <p className="text-sm text-muted">Nothing to order.</p> : null}
        {byJob(toOrder).map((jobId) => (
          <Card key={jobId} className="flex flex-col gap-2">
            <Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>
            <form action={createPurchaseOrder.bind(null, jobId)} className="flex flex-col gap-2">
              <ul className="text-sm divide-y divide-line">
                {toOrder.filter((p) => p.job_id === jobId).map((p) => (
                  <li key={p.id} className="py-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" name="part" value={p.id} defaultChecked className="h-5 w-5 accent-ink" /><span className="font-semibold">{p.description}</span></label>
                    {p.part_number ? <span className="text-muted">{p.part_number}</span> : null}
                    <span className="text-muted">× {p.confirmed_quantity ?? p.quantity} · AED {(p.cost_aed ?? 0).toFixed(2)} · {p.supplier ?? "no supplier"} · {p.availability ? AVAILABILITY_LABELS[p.availability] : ""}{p.delivery_date ? ` · ${p.delivery_date}` : ""}</span>
                    {p.advisor_added_label ? <Badge tone="outline">{p.advisor_added_label}</Badge> : null}
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Supplier</span><Input name="supplier" list="suppliers" defaultValue={toOrder.find((p) => p.job_id === jobId)?.supplier ?? ""} required className="w-64" /></label>
                <Input name="notes" placeholder="Note on the order (optional)" className="flex-1 min-w-48" />
                <Button type="submit" size="md">Raise purchase order</Button>
              </div>
            </form>
          </Card>
        ))}
        <datalist id="suppliers">{supplierNames.map((s) => <option key={s} value={s} />)}</datalist>
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className="flex flex-col gap-3">
          <SectionLabel right={`${ordered.length}`}>On order</SectionLabel>
          {ordered.length === 0 ? <p className="text-sm text-muted">Nothing on order.</p> : null}
          {byJob(ordered).map((jobId) => (
            <Card key={jobId} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>
                <LinkButton href="/parts/orders" tone="secondary" size="md">Purchase orders</LinkButton>
              </div>
              <ul className="text-sm divide-y divide-line">
                {ordered.filter((p) => p.job_id === jobId).map((p) => {
                  const late = !!p.expected_date && p.expected_date < today && p.order_status !== "to_order";
                  return (
                    <li key={p.id} className="py-1.5 flex flex-wrap items-center gap-2">
                      <Badge tone={late ? "red" : p.order_status === "to_order" ? "amber" : "neutral"}>{p.order_status === "to_order" ? "PO waiting for approval" : late ? "Late" : p.order_status === "partly_received" ? "Partly received" : "Ordered"}</Badge>
                      <span className="font-semibold">{p.description}</span>
                      {p.expected_date ? <span className="text-muted">expected {p.expected_date}</span> : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </section>
        <section className="flex flex-col gap-3">
          <SectionLabel right={`${toIssue.length}`}>Received, to issue</SectionLabel>
          {toIssue.length === 0 ? <p className="text-sm text-muted">Nothing waiting to be issued.</p> : null}
          {byJob(toIssue).map((jobId) => (
            <Card key={jobId} className="flex flex-col gap-1 border-ink">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>
                <span className="flex gap-2"><LinkButton href={`/parts/labels/${jobId}`} tone="secondary" size="md">Labels</LinkButton><LinkButton href={`/parts/issue/${jobId}`} size="md">Issue</LinkButton></span>
              </div>
              <ul className="text-sm divide-y divide-line">
                {toIssue.filter((p) => p.job_id === jobId).map((p) => (
                  <li key={p.id} className="py-1.5 flex flex-wrap items-center gap-2"><Badge tone="green">Received</Badge><span className="font-semibold">{p.description}</span>{p.label_code ? <span className="text-muted">label {p.label_code}</span> : null}</li>
                ))}
              </ul>
            </Card>
          ))}
        </section>
      </div>
    </>
  );
}

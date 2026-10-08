import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Button, Card, Empty, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { formatWait, workingMinutesSince, workingTimeOf } from "@/lib/jobs";
import { PART_SELECT, REQUEST_SELECT, toPart } from "@/lib/quote-data";
import { AVAILABILITY_LABELS, type PartItem, type PartRequest } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { setOrderStatus } from "./actions";

export const dynamic = "force-dynamic";

type JobInfo = { id: string; job_number: string; is_open: boolean; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; assignee: { display_name: string } | null };

/** The Parts role's desk: price requests from inspections, parts waiting for prices or the technician, and approved parts to order. */
export default async function PartsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string }> }) {
  await requirePermission("priceParts");
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const wt = workingTimeOf(settings);
  const target = Number(settings.parts_pricing_target_hours) || 4;
  const [{ data: reqRows }, { data: partRows }] = await Promise.all([
    admin.from("part_requests").select(REQUEST_SELECT).eq("is_active", true).in("status", ["open", "listed"]).order("created_at"),
    admin.from("part_items").select(PART_SELECT).eq("is_active", true).order("created_at"),
  ]);
  const requests = (reqRows ?? []) as PartRequest[];
  const parts = ((partRows ?? []) as Record<string, unknown>[]).map(toPart);
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
  const toOrder = parts.filter((p) => jobs.has(p.job_id) && p.order_status === "to_order");
  const ordered = parts.filter((p) => jobs.has(p.job_id) && p.order_status === "ordered");
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
        <SectionLabel right={`${toOrder.length + ordered.length}`}>To order (approved by the customer)</SectionLabel>
        <p className="text-xs text-muted">Purchase orders come in the next phase. Mark each part ordered, then received, so the job can move on.</p>
        {toOrder.length + ordered.length === 0 ? <p className="text-sm text-muted">Nothing to order.</p> : null}
        {byJob([...toOrder, ...ordered]).map((jobId) => (
          <Card key={jobId} className="flex flex-col gap-2">
            <Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>
            <ul className="text-sm divide-y divide-line">
              {[...toOrder, ...ordered].filter((p) => p.job_id === jobId).map((p: PartItem) => (
                <li key={p.id} className="py-2 flex flex-wrap items-center gap-2">
                  <Badge tone={p.order_status === "ordered" ? "amber" : "neutral"}>{p.order_status === "ordered" ? "Ordered" : "To order"}</Badge>
                  <span className="font-semibold">{p.description}</span>
                  {p.part_number ? <span className="text-muted">{p.part_number}</span> : null}
                  <span className="text-muted">× {p.confirmed_quantity ?? p.quantity} · {p.supplier ?? "no supplier"} · {p.availability ? AVAILABILITY_LABELS[p.availability] : ""}{p.delivery_date ? ` · ${p.delivery_date}` : ""}</span>
                  <form action={setOrderStatus.bind(null, p.id, p.order_status === "ordered" ? "received" : "ordered")} className="ml-auto">
                    <Button type="submit" tone="secondary" size="md">{p.order_status === "ordered" ? "Mark received" : "Mark ordered"}</Button>
                  </form>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </section>
    </>
  );
}

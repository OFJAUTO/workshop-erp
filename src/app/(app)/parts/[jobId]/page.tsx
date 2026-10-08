import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { PARTS_BUCKET, PART_SELECT, REQUEST_SELECT, signPaths, toPart } from "@/lib/quote-data";
import { AVAILABILITY_LABELS, CONFIRM_LABELS, aed, type PartRequest } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { addPartItems, closePartRequest, pricePart } from "../actions";
import { AddPartsForm, CloseRequestForm, PricePartForm } from "../PartsForms";

export const dynamic = "force-dynamic";

/** One job for the Parts team: every request with its exact parts, prices and the technician's answer. Customer name only. */
export default async function PartsJobPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "priceParts") || can(role, "editQuotes"))) notFound();
  const { jobId } = await params;
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const [{ data: job }, { data: reqRows }, { data: partRows }] = await Promise.all([
    admin.from("jobs").select("id, job_number, status, is_open, customer_id, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name)").eq("id", jobId).maybeSingle(),
    admin.from("part_requests").select(REQUEST_SELECT).eq("job_id", jobId).eq("is_active", true).order("created_at"),
    admin.from("part_items").select(PART_SELECT).eq("job_id", jobId).eq("is_active", true).order("created_at"),
  ]);
  if (!job) notFound();
  const { data: cust } = await admin.from("customer_public").select("full_name, company_name").eq("id", job.customer_id).maybeSingle();
  type V = { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  const v = job.vehicle as unknown as V;
  const requests = (reqRows ?? []) as PartRequest[];
  const parts = ((partRows ?? []) as Record<string, unknown>[]).map(toPart);
  const urls = await signPaths(PARTS_BUCKET, parts.map((p) => p.diagram_path).filter((x): x is string => !!x));
  const canPrice = can(role, "priceParts");
  const loose = parts.filter((p) => !p.part_request_id);

  const partCard = (p: (typeof parts)[number]) => (
    <div key={p.id} className="rounded-card border border-line p-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold">{p.description}</span>
        {p.part_number ? <span className="text-sm text-muted">{p.part_number}</span> : null}
        <span className="text-sm text-muted">· × {p.confirmed_quantity ?? p.quantity}</span>
        <Badge tone={p.confirm_status === "confirmed" ? "green" : p.confirm_status === "rejected" ? "red" : "amber"}>{CONFIRM_LABELS[p.confirm_status]}</Badge>
        {p.cost_aed !== null ? <Badge tone="neutral">{aed(p.cost_aed)} · {p.availability ? AVAILABILITY_LABELS[p.availability] : ""}{p.delivery_date ? ` · ${p.delivery_date}` : ""}{p.supplier ? ` · ${p.supplier}` : ""}</Badge> : <Badge tone="amber">No price yet</Badge>}
        {p.order_status !== "none" ? <Badge tone="ink">{p.order_status === "to_order" ? "To order" : p.order_status === "ordered" ? "Ordered" : "Received"}</Badge> : null}
        {p.diagram_path && urls[p.diagram_path] ? (
          <a href={urls[p.diagram_path]} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">Diagram</a>
        ) : null}
      </div>
      {p.reject_note ? <p className="text-xs text-red font-semibold">Rejected: {p.reject_note}</p> : null}
      {canPrice && p.confirm_status !== "rejected" && job.is_open ? (
        <details open={p.cost_aed === null}>
          <summary className="cursor-pointer text-xs font-semibold text-muted">{p.cost_aed === null ? "Enter the price" : "Change the price"}</summary>
          <div className="mt-2">
            <PricePartForm action={pricePart.bind(null, p.id)} initial={{ supplier: p.supplier ?? "", cost_aed: p.cost_aed === null ? "" : String(p.cost_aed), availability: p.availability ?? "", delivery_date: p.delivery_date ?? "" }} />
          </div>
        </details>
      ) : null}
    </div>
  );

  return (
    <>
      <LiveRefresh tables={["part_requests", "part_items"]} jobId={jobId} pollMs={60000} />
      <PageHeader
        title={`Parts · ${v ? formatPlate(v) : job.job_number}`}
        subtitle={`${[v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" ")} · ${job.job_number} · ${cust?.company_name ?? cust?.full_name ?? "Customer"}${(job.assignee as unknown as { display_name: string } | null)?.display_name ? ` · technician ${(job.assignee as unknown as { display_name: string }).display_name}` : ""}`}
        actions={
          <>
            <LinkButton href="/parts" tone="secondary" size="lg">Parts desk</LinkButton>
            {can(role, "viewJobs") ? <LinkButton href={`/jobs/${jobId}`} tone="secondary" size="lg">Job card</LinkButton> : null}
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {!job.is_open ? <Notice tone="info">This job is closed.</Notice> : null}

      {requests.length === 0 && loose.length === 0 ? <Notice tone="info">No parts requests on this job yet. They come from the approved inspection report.</Notice> : null}
      {requests.map((r) => {
        const items = parts.filter((p) => p.part_request_id === r.id);
        return (
          <Card key={r.id} className={`flex flex-col gap-3 ${r.status === "open" ? "border-ink" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <SectionLabel>{r.label}</SectionLabel>
              <Badge tone={r.status === "open" ? "amber" : r.status === "done" ? "green" : r.status === "rejected" ? "red" : "neutral"}>{r.status === "open" ? "To price" : r.status === "listed" ? "Parts listed" : r.status === "done" ? "Done" : "Closed"}</Badge>
              <span className="text-xs text-muted">from the report · {formatDateTime(r.created_at)}</span>
            </div>
            {r.requested_text ? <p className="text-sm"><span className="text-muted">Technician wrote:</span> {r.requested_text}</p> : null}
            {items.map(partCard)}
            {job.is_open && r.status !== "rejected" ? (
              <details open={items.length === 0}>
                <summary className="cursor-pointer text-sm font-bold">{items.length ? "Add more parts to this request" : "List the exact parts"}</summary>
                <div className="mt-3">
                  <AddPartsForm action={addPartItems.bind(null, jobId, r.id)} />
                </div>
              </details>
            ) : null}
            {canPrice && r.status === "open" && job.is_open ? <CloseRequestForm action={closePartRequest.bind(null, r.id)} /> : null}
          </Card>
        );
      })}

      <Card className="flex flex-col gap-3">
        <SectionLabel right={loose.length ? `${loose.length}` : undefined}>Parts added without a request</SectionLabel>
        {loose.map(partCard)}
        {job.is_open ? (
          <details>
            <summary className="cursor-pointer text-sm font-bold">Add a part the technician did not list</summary>
            <div className="mt-3">
              <AddPartsForm action={addPartItems.bind(null, jobId, null)} />
            </div>
          </details>
        ) : null}
      </Card>
    </>
  );
}

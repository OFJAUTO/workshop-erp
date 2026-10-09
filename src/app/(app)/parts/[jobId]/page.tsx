import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { PARTS_BUCKET, PART_SELECT, REQUEST_SELECT, signPaths, toPart } from "@/lib/quote-data";
import { AVAILABILITY_LABELS, aed, partTypeText, type PartItem, type PartRequest } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { addOption, askManager, closePartRequest, coverRequest, removePart, savePartRows, updatePart } from "../actions";
import { AskManagerForm, CloseRequestForm, OnePartForm, PartRowsForm } from "../PartsForms";
import { allInStock, partsPlanned, setPartPlan } from "../../jobs/planning-actions";
import { PlanPartRow, type PlanPart } from "./PlanParts";

export const dynamic = "force-dynamic";

/** One job for the Parts team: every request with its parts, in one row each. Customer name only, no quotation figures. */
export default async function PartsJobPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "priceParts") || can(role, "editQuotes"))) notFound();
  const { jobId } = await params;
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const [{ data: job }, { data: reqRows }, { data: partRows }, { data: supplierRows }, { data: names }] = await Promise.all([
    admin.from("jobs").select("id, job_number, status, is_open, customer_id, plan_parts_done_at, plan_parts_ready_date, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name)").eq("id", jobId).maybeSingle(),
    admin.from("part_requests").select(REQUEST_SELECT).eq("job_id", jobId).eq("is_active", true).order("created_at"),
    admin.from("part_items").select(PART_SELECT + ", po_id, expected_date, received_qty, issue_status, return_status").eq("job_id", jobId).eq("is_active", true).order("created_at"),
    admin.from("suppliers").select("name").eq("is_active", true).order("name"),
    admin.from("staff").select("id, display_name").eq("is_active", true),
  ]);
  if (!job) notFound();
  const { data: cust } = await admin.from("customer_public").select("full_name, company_name").eq("id", job.customer_id).maybeSingle();
  type V = { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
  const v = job.vehicle as unknown as V;
  const requests = (reqRows ?? []) as PartRequest[];
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map(toPart);
  const rawById = new Map(((partRows ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r.id), r]));
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.display_name]));
  // Planning inside the Parts step: the approved parts, in stock or to order with the date.
  const inPlanning = ["approved", "waiting_parts"].includes(job.status) && job.is_open;
  const planParts: PlanPart[] = parts.filter((p) => p.order_status !== "none" && String(rawById.get(p.id)?.return_status ?? "none") !== "returned").map((p) => {
    const raw = rawById.get(p.id) ?? {};
    return { id: p.id, description: p.description, quantity: Number(p.confirmed_quantity ?? p.quantity) || 1, availability: p.availability, delivery_date: p.delivery_date, order_status: p.order_status, expected_date: (raw.expected_date as string | null) ?? null, received: p.order_status === "received" || Number(raw.received_qty ?? 0) > 0, days: toValues(p).days };
  });
  const unplanned = planParts.filter((p) => !p.received && p.order_status !== "ordered" && p.order_status !== "partly_received" && (!p.availability || (p.availability === "to_order" && !p.delivery_date)));
  const urls = await signPaths(PARTS_BUCKET, parts.map((p) => p.diagram_path).filter((x): x is string => !!x));
  const suppliers = Array.from(new Set([...(supplierRows ?? []).map((s) => s.name as string), ...parts.map((p) => p.supplier).filter((x): x is string => !!x)])).sort();
  const canPrice = can(role, "priceParts") && !staff.viewingAs && job.is_open;
  const types = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  const defaultType = types[0] ?? "genuine";
  const loose = parts.filter((p) => !p.part_request_id);
  // eslint-disable-next-line react-hooks/purity -- a server page: rendered once per request, the clock is read once
  const toValues = (p: PartItem) => ({ part_number: p.part_number ?? "", description: p.description, quantity: String(p.quantity), part_type: p.part_type ?? defaultType, brand: p.brand ?? "", cost_aed: p.cost_aed === null ? "" : String(p.cost_aed), supplier: p.supplier ?? "", availability: p.availability ?? "in_stock", days: p.delivery_date ? String(Math.max(1, Math.round((Date.parse(p.delivery_date) - Date.now()) / 86400000))) : "" });

  const partRow = (p: PartItem) => (
    <li key={p.id} className="py-2 flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold">{p.description}</span>
        {p.part_number ? <span className="text-muted">{p.part_number}</span> : null}
        <span className="text-muted">× {p.quantity}</span>
        {p.part_type ? <Badge tone="outline">{partTypeText(p)}</Badge> : <Badge tone="amber">Type not set</Badge>}
        {p.cost_aed !== null ? <Badge tone="neutral">{aed(p.cost_aed)} · {p.supplier ?? "no supplier"}</Badge> : <Badge tone="amber">No price yet</Badge>}
        {p.availability ? <Badge tone={p.availability === "in_stock" ? "green" : "neutral"}>{AVAILABILITY_LABELS[p.availability]}{p.delivery_date ? ` · ${p.delivery_date}` : ""}</Badge> : null}
        {p.option_group ? <Badge tone="ink">Option</Badge> : null}
        {p.order_status !== "none" ? <Badge tone="ink">{p.order_status === "to_order" ? "To order" : p.order_status === "ordered" ? "Ordered" : p.order_status === "partly_received" ? "Partly received" : "Received"}</Badge> : null}
        {p.diagram_path && urls[p.diagram_path] ? <a href={urls[p.diagram_path]} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">Diagram</a> : null}
      </div>
      {p.question_text ? (
        <p className="text-xs">
          <span className="font-semibold">Asked the manager:</span> {p.question_text}
          {p.answer_text ? <span className="font-semibold text-green"> · {nameOf.get(p.answered_by ?? "") ?? "Manager"} answered: {p.answer_text}</span> : <span className="text-muted"> · waiting for the answer</span>}
        </p>
      ) : null}
      {canPrice ? (
        <div className="flex flex-wrap items-center gap-3">
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-muted">Change</summary>
            <div className="mt-2"><OnePartForm action={updatePart.bind(null, p.id)} initial={toValues(p)} suppliers={suppliers} submitLabel="Save changes" /></div>
          </details>
          {p.order_status === "none" ? (
            <details>
              <summary className="cursor-pointer text-xs font-semibold text-muted">Add another option (for example Genuine beside Aftermarket)</summary>
              <div className="mt-2"><OnePartForm action={addOption.bind(null, p.id)} initial={{ ...toValues(p), part_type: "", brand: "", cost_aed: "" }} suppliers={suppliers} submitLabel="Add option" /></div>
            </details>
          ) : null}
          {!p.question_text || p.answer_text ? <AskManagerForm action={askManager.bind(null, p.id)} /> : null}
          {p.order_status === "none" ? (
            <form action={removePart.bind(null, p.id)}><button type="submit" className="text-xs font-semibold text-red underline underline-offset-4">Remove</button></form>
          ) : null}
        </div>
      ) : null}
    </li>
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
      {inPlanning ? (
        <Card id="planning" className={`flex flex-col gap-3 ${job.plan_parts_done_at ? "border-green" : "border-ink"}`}>
          <div className="flex flex-wrap items-center gap-2">
            <SectionLabel right={planParts.length ? `${planParts.length - unplanned.length} of ${planParts.length} decided` : undefined}>Planning: the approved parts</SectionLabel>
            {job.plan_parts_done_at ? <Badge tone="green">Parts planned{job.plan_parts_ready_date ? ` · all here by ${job.plan_parts_ready_date}` : ""}</Badge> : <Badge tone="amber">Your turn</Badge>}
          </div>
          {planParts.length === 0 ? <p className="text-sm">No parts on this job. Press Parts planned so the workshop manager can plan the work.</p> : <p className="text-xs text-muted">For each part: In stock, or To order with the days until it arrives. Then press Parts planned; the workshop manager is next.</p>}
          {canPrice ? (
            <>
              <div className="divide-y divide-line">{planParts.map((p) => <PlanPartRow key={p.id} part={p} action={setPartPlan.bind(null, p.id)} />)}</div>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                {unplanned.length ? <form action={allInStock.bind(null, jobId)}><input type="hidden" name="from" value="parts" /><Button type="submit" tone="secondary" size="md">All in stock</Button></form> : null}
                <form action={partsPlanned.bind(null, jobId)}><input type="hidden" name="from" value="parts" /><Button type="submit" size="md" disabled={unplanned.length > 0}>{job.plan_parts_done_at ? "Parts planned again (date changed)" : "Parts planned"}</Button></form>
                {unplanned.length ? <span className="text-xs text-muted">{unplanned.length} part{unplanned.length === 1 ? "" : "s"} still to decide.</span> : null}
              </div>
            </>
          ) : null}
        </Card>
      ) : null}
      <p className="text-xs text-muted">Each row is the whole answer: part number, description, quantity, type, cost, supplier and availability. Saved parts go straight onto the quotation; nobody has to confirm them.</p>

      {requests.length === 0 && loose.length === 0 ? <Notice tone="info">No parts requests on this job yet. They come from the approved inspection report.</Notice> : null}
      {requests.map((r) => {
        const items = parts.filter((p) => p.part_request_id === r.id);
        return (
          <Card key={r.id} className={`flex flex-col gap-3 ${r.status === "open" ? "border-ink" : ""}`}>
            <div className="flex flex-wrap items-center gap-2">
              <SectionLabel>{r.label}</SectionLabel>
              <Badge tone={r.status === "open" ? "amber" : r.status === "done" ? "green" : r.status === "rejected" ? "neutral" : "neutral"}>{r.status === "open" ? "To price" : r.status === "done" || r.status === "listed" ? "Done" : r.closed_reason === "Already covered in another request" ? "Covered elsewhere" : "Closed"}</Badge>
              <span className="text-xs text-muted">from the report · {formatDateTime(r.created_at)}</span>
            </div>
            {r.requested_text ? <p className="text-sm"><span className="text-muted">Technician wrote:</span> {r.requested_text}{r.quantity ? <span className="text-muted"> · × {r.quantity}{r.unit ? ` ${r.unit}` : ""}</span> : null}</p> : null}
            {r.closed_reason && r.status === "rejected" ? <p className="text-xs text-muted">{r.closed_reason}</p> : null}
            {items.length ? <ul className="divide-y divide-line">{items.map(partRow)}</ul> : null}
            {canPrice && r.status !== "rejected" ? (
              <details open={items.length === 0}>
                <summary className="cursor-pointer text-sm font-bold">{items.length ? "Add more parts to this request" : "Enter the parts"}</summary>
                <div className="mt-3"><PartRowsForm action={savePartRows.bind(null, jobId, r.id)} suppliers={suppliers} defaultType={defaultType} /></div>
              </details>
            ) : null}
            {canPrice && r.status === "open" ? (
              <div className="flex flex-wrap items-center gap-4">
                <form action={coverRequest.bind(null, r.id)}><Button type="submit" tone="secondary" size="md">Already covered in another request</Button></form>
                <CloseRequestForm action={closePartRequest.bind(null, r.id)} />
              </div>
            ) : null}
          </Card>
        );
      })}

      <Card className="flex flex-col gap-3">
        <SectionLabel right={loose.length ? `${loose.length}` : undefined}>Parts added without a request</SectionLabel>
        {loose.length ? <ul className="divide-y divide-line">{loose.map(partRow)}</ul> : null}
        {canPrice ? (
          <details>
            <summary className="cursor-pointer text-sm font-bold">Add a part the technician did not list</summary>
            <div className="mt-3"><PartRowsForm action={savePartRows.bind(null, jobId, null)} suppliers={suppliers} defaultType={defaultType} /></div>
          </details>
        ) : null}
      </Card>
    </>
  );
}

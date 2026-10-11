import { CopyVin } from "@/components/CopyVin";
import { notFound } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { inspectionDangerous, loadInspection } from "@/lib/inspection-data";
import { formatPromised } from "@/lib/jobs";
import { PARTS_BUCKET, PART_SELECT, REQUEST_SELECT, signPaths, toPart } from "@/lib/quote-data";
import { AVAILABILITY_LABELS, aed, partTypeText, type PartItem, type PartRequest } from "@/lib/quotes";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { addOption, askManager, closePartRequest, coverRequest, markRequestUnavailable, removePart, savePartRows, updatePart } from "../actions";
import { AskManagerForm, CloseRequestForm, OnePartForm, PARTS_GRID, PartRowsForm, UnavailableForm } from "../PartsForms";
import { allInStock, partsPlanned, setPartPlan } from "../../jobs/planning-actions";
import { PlanPartRow, type PlanPart } from "./PlanParts";

export const dynamic = "force-dynamic";

/**
 * One job for the Parts team: a header with the car and one table, Part · Qty · Part number · Type · Cost ·
 * Supplier · Availability. A request is a row to fill; a priced part is a row with its figures. Nothing from
 * the inspection report here but the parts themselves and the Dangerous flag. Customer name only, no quotation figures.
 */
export default async function PartsJobPage({ params, searchParams }: { params: Promise<{ jobId: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "priceParts") || can(role, "editQuotes"))) notFound();
  const { jobId } = await params;
  const { message, error } = await searchParams;
  const admin = createAdminClient();
  const settings = await getSettings();
  const [{ data: job }, { data: reqRows }, { data: partRows }, { data: supplierRows }, { data: names }, insp] = await Promise.all([
    admin.from("jobs").select("id, job_number, status, is_open, customer_id, promised_at, plan_parts_done_at, plan_parts_ready_date, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name)").eq("id", jobId).maybeSingle(),
    admin.from("part_requests").select(REQUEST_SELECT).eq("job_id", jobId).eq("is_active", true).order("created_at"),
    admin.from("part_items").select(PART_SELECT + ", po_id, expected_date, received_qty, issue_status, return_status").eq("job_id", jobId).eq("is_active", true).order("created_at"),
    admin.from("suppliers").select("name").eq("is_active", true).order("name"),
    admin.from("staff").select("id, display_name").eq("is_active", true),
    loadInspection(jobId),
  ]);
  if (!job) notFound();
  const { data: cust } = await admin.from("customer_public").select("full_name, company_name").eq("id", job.customer_id).maybeSingle();
  type V = { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null };
  const v = job.vehicle as unknown as V;
  const requests = (reqRows ?? []) as PartRequest[];
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map(toPart);
  const rawById = new Map(((partRows ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r.id), r]));
  const nameOf = new Map((names ?? []).map((n) => [n.id, n.display_name]));
  const dangers = insp ? inspectionDangerous(insp) : [];
  // Planning inside the Parts step: the approved parts, in stock or to order with the date.
  const inPlanning = ["approved", "waiting_parts"].includes(job.status) && job.is_open;
  const types = ((settings.part_types ?? []) as string[]).map((t) => t.toLowerCase());
  const defaultType = types[0] ?? "genuine";
  // Declared before planParts, which reads the days from it.
  // eslint-disable-next-line react-hooks/purity -- a server page: rendered once per request, the clock is read once
  const toValues = (p: PartItem) => ({ part_number: p.part_number ?? "", description: p.description, quantity: String(p.quantity), part_type: p.part_type ?? defaultType, brand: p.brand ?? "", cost_aed: p.cost_aed === null ? "" : String(p.cost_aed), supplier: p.supplier ?? "", availability: p.availability ?? "in_stock", days: p.delivery_date ? String(Math.max(1, Math.round((Date.parse(p.delivery_date) - Date.now()) / 86400000))) : "" });
  const planParts: PlanPart[] = parts.filter((p) => p.order_status !== "none" && String(rawById.get(p.id)?.return_status ?? "none") !== "returned").map((p) => {
    const raw = rawById.get(p.id) ?? {};
    return { id: p.id, description: p.description, quantity: Number(p.confirmed_quantity ?? p.quantity) || 1, availability: p.availability, delivery_date: p.delivery_date, order_status: p.order_status, expected_date: (raw.expected_date as string | null) ?? null, received: Number(raw.received_qty ?? 0) >= Number(p.confirmed_quantity ?? p.quantity), days: toValues(p).days };
  });
  const unplanned = planParts.filter((p) => !p.received && p.order_status !== "ordered" && p.order_status !== "partly_received" && (!p.availability || (p.availability === "to_order" && !p.delivery_date)));
  const urls = await signPaths(PARTS_BUCKET, parts.map((p) => p.diagram_path).filter((x): x is string => !!x));
  const suppliers = Array.from(new Set([...(supplierRows ?? []).map((s) => s.name as string), ...parts.map((p) => p.supplier).filter((x): x is string => !!x)])).sort();
  const canPrice = can(role, "priceParts") && !staff.viewingAs && job.is_open;
  const loose = parts.filter((p) => !p.part_request_id);
  const requestInfo = (r: PartRequest) => [r.positions?.length ? r.positions.join(", ") : "", r.note ?? ""].filter(Boolean).join(" · ") || null;
  const orderBadge = (p: PartItem) => (p.order_status === "none" ? null : <Badge tone="ink">{p.order_status === "to_order" ? "To order" : p.order_status === "ordered" ? "Ordered" : p.order_status === "partly_received" ? "Partly received" : "Received"}</Badge>);

  const header = (
    <div className={`${PARTS_GRID} hidden md:grid border-b border-line pb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-muted`}>
      <span>Part</span><span className="text-center">Qty</span><span>Part number</span><span>Type</span><span className="text-right">Cost</span><span>Supplier</span><span>Availability</span><span />
    </div>
  );

  /** A priced part: its figures in the columns, the changes behind one small menu. */
  const partRow = (p: PartItem, info?: string | null) => (
    <div key={p.id} className={`${PARTS_GRID} py-2 text-sm`}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-bold">{p.description}</span>
          {p.option_group ? <Badge tone="ink">Option</Badge> : null}
          {orderBadge(p)}
          {p.diagram_path && urls[p.diagram_path] ? <a href={urls[p.diagram_path]} target="_blank" rel="noreferrer" className="text-xs font-bold underline underline-offset-4">Diagram</a> : null}
        </span>
        {info ? <span className="text-[11px] text-muted">{info}</span> : null}
        {p.question_text ? (
          <span className="text-[11px]">
            <span className="font-semibold">Asked the manager:</span> {p.question_text}
            {p.answer_text ? <span className="font-semibold text-green"> · {nameOf.get(p.answered_by ?? "") ?? "Manager"}: {p.answer_text}</span> : <span className="text-muted"> · waiting</span>}
          </span>
        ) : null}
      </div>
      <span className="text-center font-semibold">{p.quantity}</span>
      <span className="text-muted truncate">{p.part_number ?? ""}</span>
      <span>{p.part_type ? partTypeText(p) : <Badge tone="amber">Type not set</Badge>}</span>
      <span className="text-right font-semibold">{p.cost_aed !== null ? aed(p.cost_aed) : <Badge tone="amber">No price</Badge>}</span>
      <span className="truncate">{p.supplier ?? <span className="text-muted">no supplier</span>}</span>
      <span>{p.availability ? <Badge tone={p.availability === "in_stock" ? "green" : "neutral"}>{AVAILABILITY_LABELS[p.availability]}{p.delivery_date ? ` · ${p.delivery_date}` : ""}</Badge> : null}</span>
      <div className="flex justify-end">
        {canPrice ? (
          <details className="relative">
            <summary className="list-none cursor-pointer inline-flex min-h-9 min-w-9 items-center justify-center rounded-control border border-line text-base font-bold" aria-label="More">⋯</summary>
            <div className="mt-1 flex flex-col gap-2 rounded-card border border-line bg-white p-3 text-xs shadow-sm md:absolute md:right-0 md:z-20 md:w-[42rem]">
              <details>
                <summary className="cursor-pointer font-semibold">Change</summary>
                <div className="mt-2"><OnePartForm action={updatePart.bind(null, p.id)} initial={toValues(p)} suppliers={suppliers} submitLabel="Save changes" /></div>
              </details>
              {p.order_status === "none" ? (
                <details>
                  <summary className="cursor-pointer font-semibold">Add another option (for example Genuine beside Aftermarket)</summary>
                  <div className="mt-2"><OnePartForm action={addOption.bind(null, p.id)} initial={{ ...toValues(p), part_type: "", brand: "", cost_aed: "" }} suppliers={suppliers} submitLabel="Add option" /></div>
                </details>
              ) : null}
              {!p.question_text || p.answer_text ? <AskManagerForm action={askManager.bind(null, p.id)} /> : null}
              {p.order_status === "none" ? (
                <form action={removePart.bind(null, p.id)}><button type="submit" className="font-semibold text-red underline underline-offset-4">Remove</button></form>
              ) : null}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  );

  const openRequests = requests.filter((r) => r.status !== "rejected" && r.status !== "unavailable" && !parts.some((p) => p.part_request_id === r.id));
  const answered = requests.filter((r) => parts.some((p) => p.part_request_id === r.id));
  const closed = requests.filter((r) => (r.status === "rejected" || r.status === "unavailable") && !parts.some((p) => p.part_request_id === r.id));

  return (
    <>
      <LiveRefresh tables={["part_requests", "part_items"]} jobId={jobId} pollMs={60000} />
      <PageHeader
        title={`Parts · ${v ? formatPlate(v) : job.job_number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{[v?.make?.name, v?.model?.name, v?.model_year].filter(Boolean).join(" ")} · {job.job_number} · {cust?.company_name ?? cust?.full_name ?? "Customer"}{(job.assignee as unknown as { display_name: string } | null)?.display_name ? ` · technician ${(job.assignee as unknown as { display_name: string }).display_name}` : ""}</span>
            {job.promised_at ? <Badge tone="outline">Promised {formatPromised(job.promised_at)}</Badge> : null}
            {dangers.length ? <Badge tone="red">Dangerous to drive</Badge> : null}
          </span>
        }
        actions={
          <>
            <CopyVin vin={v?.vin} />
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
          {planParts.length === 0 ? <p className="text-sm">No parts on this job. Press Parts planned so the workshop manager can plan the work.</p> : <p className="text-xs text-muted">For each part: In stock, or To order with the days until it arrives. Then press Parts planned.</p>}
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

      <Card className="flex flex-col gap-2">
        <SectionLabel right={`${openRequests.length} to price · ${parts.length} priced`}>Parts</SectionLabel>
        {requests.length === 0 && loose.length === 0 ? <p className="text-sm text-muted">No parts on this job yet. They come from the confirmed parts list of the inspection report, or an advisor adds one on the quotation.</p> : null}
        {header}
        <div className="divide-y divide-line">
          {openRequests.map((r) => (
            <div key={r.id} className="flex flex-col gap-1 py-1">
              {canPrice ? (
                <PartRowsForm action={savePartRows.bind(null, jobId, r.id)} suppliers={suppliers} defaultType={defaultType} initial={{ description: r.label, quantity: String(r.quantity ?? 1) }} info={requestInfo(r)} />
              ) : (
                <div className={`${PARTS_GRID} py-2 text-sm`}>
                  <span className="flex flex-col"><span className="font-bold">{r.label}</span>{requestInfo(r) ? <span className="text-[11px] text-muted">{requestInfo(r)}</span> : null}</span>
                  <span className="text-center font-semibold">{r.quantity ?? 1}</span>
                  <span className="col-span-5"><Badge tone="amber">To price</Badge></span>
                  <span />
                </div>
              )}
              {canPrice && r.status === "open" ? (
                <details>
                  <summary className="cursor-pointer text-[11px] font-semibold text-muted">Cannot supply this one?</summary>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <UnavailableForm action={markRequestUnavailable.bind(null, r.id)} />
                    <form action={coverRequest.bind(null, r.id)}><Button type="submit" tone="secondary" size="md">Already covered in another request</Button></form>
                    <CloseRequestForm action={closePartRequest.bind(null, r.id)} />
                  </div>
                </details>
              ) : null}
            </div>
          ))}
          {answered.map((r) => {
            const items = parts.filter((p) => p.part_request_id === r.id);
            return (
              <div key={r.id} className="flex flex-col">
                {items.map((p, i) => partRow(p, i === 0 ? requestInfo(r) : null))}
                {canPrice && r.status !== "rejected" && r.status !== "unavailable" ? (
                  <details className="pb-2">
                    <summary className="cursor-pointer text-[11px] font-semibold text-muted">Add more parts to this request</summary>
                    <div className="mt-1"><PartRowsForm action={savePartRows.bind(null, jobId, r.id)} suppliers={suppliers} defaultType={defaultType} info={r.label} /></div>
                  </details>
                ) : null}
              </div>
            );
          })}
          {loose.map((p) => partRow(p, "Added without a request"))}
          {closed.map((r) => (
            <div key={r.id} className={`${PARTS_GRID} py-2 text-sm opacity-70`}>
              <span className="font-bold">{r.label}</span>
              <span className="text-center">{r.quantity ?? 1}</span>
              <span className="col-span-5 flex flex-wrap items-center gap-2"><Badge tone={r.status === "unavailable" ? "red" : "neutral"}>{r.status === "unavailable" ? "Not available" : "Closed"}</Badge>{r.closed_reason ? <span className="text-xs text-muted">{r.closed_reason}</span> : null}</span>
              <span />
            </div>
          ))}
        </div>
        {canPrice ? (
          <details className="border-t border-line pt-2">
            <summary className="cursor-pointer text-sm font-bold">+ Add a part the technician did not list</summary>
            <div className="mt-2"><PartRowsForm action={savePartRows.bind(null, jobId, null)} suppliers={suppliers} defaultType={defaultType} /></div>
          </details>
        ) : null}
      </Card>
    </>
  );
}

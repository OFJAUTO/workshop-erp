import { formatDate } from "@/lib/format";
import { JobAdvisorTag } from "@/components/JobAdvisorTag";
import { jobAdvisorsFor } from "@/lib/job-advisor";
import { estimateTaskWords, loadEstimatesToPrice } from "@/lib/estimate-parts-data";
import { seesCustomers } from "@/lib/customer-data";
import { partsWithNoHome } from "@/lib/handover";
import { creditNotesAwaited } from "@/lib/part-endings-server";
import { CarThumb } from "@/components/CarThumb";
import { signCarPictures } from "@/lib/car-pictures";
import { PAST_QUOTE, partsSteps, stepPartOf } from "@/lib/parts-steps";
import { approvedPartIds } from "@/lib/parts-changes-data";
import { CopyVin } from "@/components/CopyVin";
import Link from "next/link";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Button, Input,Badge, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { STATUS_LABELS, type JobStatus,formatWait, workingMinutesSince, workingTimeOf } from "@/lib/jobs";
import { REQUEST_SELECT } from "@/lib/quote-data";
import { PART_FULL_SELECT, PO_LINE_SELECT, PO_SELECT, partAdvisorCols, partUnitsOf, toPartFull, toPo, toPoLine } from "@/lib/parts-data";
import { SupplierLpoCard } from "./SupplierLpoCard";
import { supplierVatLookup } from "@/lib/supplier-vat";
import { emailSupplierLpo, markSupplierOrdered, setPartExpectedDate } from "./lpo-actions";
import { gmailConfigured } from "@/lib/gmail";
import { formatDayTime } from "@/lib/format";
import { type PartRequest } from "@/lib/quotes";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { chargesByPo } from "@/lib/supplier-charges";
import { formatPlate } from "@/lib/types";
import { WaitingPanel } from "@/components/WaitingPanel";
import { PartsSteps } from "@/components/PartsSteps";
import { realPartNumber } from "@/lib/parts-rows";
import { pricesToFix } from "@/lib/part-cost-history";
import { PricesToFix } from "./PricesToFix";
import { pricingTodoOf } from "@/lib/pricing-done";
import { JobTechnicianTag } from "@/components/JobTechnicianTag";
import { jobTechniciansFor, type CarTechnicians } from "@/lib/job-technician";

export const dynamic = "force-dynamic";

const todayIso = () => new Date().toISOString().slice(0, 10);

type JobInfo = { id: string; job_number: string; is_open: boolean; status: string; parts_pricing_done_at: string | null; parts_pricing_reopened_at: string | null; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; assignee: { display_name: string } | null };

/** The Parts role's desk: price requests from inspections, parts waiting for prices or the technician, and approved parts to order. */
type AllJob = { id: string; job_number: string; status: string; is_open: boolean; gated_in_at: string; gated_out_at: string | null; parts_pricing_done_at: string | null; parts_pricing_reopened_at: string | null; vehicle: { kind?: string | null; photo_path?: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null; customer: { full_name: string; company_name: string | null } | null };
const ALL_JOB_SELECT = "id, job_number, status, is_open, gated_in_at, gated_out_at, parts_pricing_done_at, parts_pricing_reopened_at, vehicle:vehicles(kind, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), customer:customers(full_name, company_name)";

export default async function PartsPage({ searchParams }: { searchParams: Promise<{ message?: string; error?: string; q?: string; advisor?: string; tech?: string }> }) {
  const staff = await requirePermission("priceParts");
  // 30 October 2026: estimates whose parts were sent to the desk (or priced by the advisor, to check). The car is not here yet.
  const estimatesToPrice = await loadEstimatesToPrice();
  // Customers are for the owner, advisors and accounts only (29 October 2026): Parts find a car by plate, job number or VIN.
  const seesCust = seesCustomers(staff.role_id);
  const { message, error, q: rawQ, advisor: rawAdvisor, tech: rawTech } = await searchParams;
  const q = String(rawQ ?? "").trim().slice(0, 60);
  const admin = createAdminClient();
  const settings = await getSettings();
  const wt = workingTimeOf(settings);
  const target = Number(settings.parts_pricing_target_hours) || 4;
  const [{ data: reqRows }, { data: partRows }] = await Promise.all([
    admin.from("part_requests").select(REQUEST_SELECT).eq("is_active", true).in("status", ["open"]).order("created_at"),
    admin.from("part_items").select(PART_FULL_SELECT + (await partAdvisorCols())).eq("is_active", true).order("created_at"),
  ]);
  const requests = (reqRows ?? []) as PartRequest[];
  // Parts without a home, and returns still waiting for the supplier's credit note (3 November 2026): one count on the tab.
  const noHomeCount = (await partsWithNoHome()).length + (await creditNotesAwaited()).length;
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull).map((p) => ({ ...p, advisor_added_label: p.added_by_role === "service_advisor" && !p.part_request_id ? "Added by advisor" : null }));
  // Parts added after the customer's approval hold a car's dots open (5 November 2026, J-00985): which parts each job's approved quotations carry.
  const approvedMap = await approvedPartIds(Array.from(new Set(parts.map((p) => p.job_id))));
  const ctxOf = (jobId: string, status: string) => ({ pastQuote: PAST_QUOTE.includes(status), approvedIds: approvedMap.get(jobId) ?? new Set<string>() });
  const today = todayIso();
  // A car whose only changes wait for the send (a request marked not available, a part removed) has no open request
  // and maybe no active part: it is listed through its own "changes waiting" mark (review of 3 November 2026).
  const { data: heldRows } = await admin.from("jobs").select("id").eq("is_open", true).not("parts_pricing_reopened_at", "is", null).limit(300);
  const jobIds = Array.from(new Set([...requests.map((r) => r.job_id), ...parts.map((p) => p.job_id), ...(heldRows ?? []).map((j) => j.id as string)]));
  const { data: jobRows } = jobIds.length ? await admin.from("jobs").select("id, job_number, is_open, status, parts_pricing_done_at, parts_pricing_reopened_at, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name)").in("id", jobIds) : { data: [] };
  const jobs = new Map(((jobRows ?? []) as unknown as JobInfo[]).filter((j) => j.is_open).map((j) => [j.id, j]));
  // ORDER NOW: every approved supplier or stock LPO as a big card with its own clock.
  const amberMin = Number(settings.order_now_amber_minutes) || 30;
  const redMin = Number(settings.order_now_red_minutes) || 60;
  const [{ data: onRaw }, { data: pendRaw }] = await Promise.all([
    admin.from("purchase_orders").select(PO_SELECT).eq("is_active", true).eq("status", "approved").in("kind", ["supplier", "stock"]).order("approved_at"),
    admin.from("purchase_orders").select(PO_SELECT).eq("is_active", true).eq("status", "pending_approval").order("created_at"),
  ]);
  const orderNowPos = ((onRaw ?? []) as Record<string, unknown>[]).map(toPo);
  const pendingPos = ((pendRaw ?? []) as Record<string, unknown>[]).map(toPo);
  const onIds = orderNowPos.map((p) => p.id);
  const { data: onLineRows } = onIds.length ? await admin.from("purchase_order_lines").select(PO_LINE_SELECT).in("po_id", onIds).eq("is_active", true).order("position") : { data: [] };
  const onLines = new Map<string, ReturnType<typeof toPoLine>[]>();
  for (const r of (onLineRows ?? []) as Record<string, unknown>[]) {
    const l = toPoLine(r);
    onLines.set(l.po_id, [...(onLines.get(l.po_id) ?? []), l]);
  }
  const onCharges = await chargesByPo(onIds);
  // Each ORDER NOW line's unit (pieces, litres, sets): "× 8 L" on the card and in the supplier copy.
  const unitOfPart = await partUnitsOf(Array.from(onLines.values()).flat().map((l) => l.part_item_id));
  const approverIds = Array.from(new Set(orderNowPos.map((p) => p.approved_by).filter((x): x is string => !!x)));
  const { data: approverRows } = approverIds.length ? await admin.from("staff").select("id, display_name").in("id", approverIds) : { data: [] as { id: string; display_name: string }[] };
  const approverName = new Map((approverRows ?? []).map((x) => [x.id, x.display_name]));
  // Supplier amounts with VAT (5 November 2026): THE rule, per supplier, for the LPO cards below.
  const vatOf = await supplierVatLookup();
  const supplierIds = Array.from(new Set(orderNowPos.map((p) => p.supplier_id).filter((x): x is string => !!x)));
  const { data: supplierRows } = supplierIds.length ? await admin.from("suppliers").select("id, email").in("id", supplierIds) : { data: [] as { id: string; email: string | null }[] };
  const supplierEmail = new Map((supplierRows ?? []).map((x) => [x.id, x.email]));
  // Extra job lines for LPO jobs the request/part lists may not carry.
  const extraJobIds = [...orderNowPos, ...pendingPos].map((p) => p.job_id).filter((x): x is string => !!x && !jobs.has(x));
  if (extraJobIds.length) {
    const { data: extraJobs } = await admin.from("jobs").select("id, job_number, is_open, status, parts_pricing_done_at, parts_pricing_reopened_at, vehicle:vehicles(has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)), assignee:staff!jobs_assigned_to_fkey(display_name)").in("id", Array.from(new Set(extraJobIds)));
    for (const j of ((extraJobs ?? []) as unknown as JobInfo[]).filter((j) => j.is_open)) jobs.set(j.id, j);
  }
  // The car's advisor on every line (6 November 2026, Peter) and the Advisor filter: All / Adarsh / … Internal only.
  const advisorOf = await jobAdvisorsFor(Array.from(jobs.keys()));
  const advisorFilter = String(rawAdvisor ?? "").trim();
  const advisorNames = new Map<string, string>();
  for (const a of advisorOf.values()) if (a.advisorId && a.advisorName) advisorNames.set(a.advisorId, a.advisorName);
  // The technician on every line and the Technician filter (8 November 2026, Peter). Internal only.
  const techOf = await jobTechniciansFor(Array.from(jobs.keys()));
  const techFilter = String(rawTech ?? "").trim();
  const techNames = new Map<string, string>();
  const onCar = (t: CarTechnicians | undefined, id: string) => !!t && [...t.mechanical, ...t.bodyshop].some((x) => x.id === id);
  if (advisorFilter) for (const id of Array.from(jobs.keys())) if (advisorOf.get(id)?.advisorId !== advisorFilter) jobs.delete(id);
  if (techFilter) for (const id of Array.from(jobs.keys())) if (!onCar(techOf.get(id), techFilter)) jobs.delete(id);
  const orderNowShown = advisorFilter || techFilter ? orderNowPos.filter((po) => !!po.job_id && jobs.has(po.job_id)) : orderNowPos;
  const pendingShown = advisorFilter || techFilter ? pendingPos.filter((po) => !!po.job_id && jobs.has(po.job_id)) : pendingPos;
  const estimatesShown = techFilter ? [] : advisorFilter ? estimatesToPrice.filter((e) => e.advisorId === advisorFilter) : estimatesToPrice;

  const jobLine = (id: string) => {
    const j = jobs.get(id);
    if (!j) return null;
    return `${j.vehicle ? formatPlate(j.vehicle) : ""} · ${[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · ${j.job_number}${j.assignee ? ` · ${j.assignee.display_name}` : ""}`;
  };
  /** The five steps of a car's parts as dots (the same rule as the car's parts page). */
  const dotsOf = (jobId: string) => {
    const j = jobs.get(jobId);
    if (!j) return null;
    return <PartsSteps size="dots" steps={partsSteps({ jobStatus: j.status, pricingDoneAt: j.parts_pricing_done_at, pricingReopenedAt: j.parts_pricing_reopened_at, parts: parts.filter((p) => p.job_id === jobId).map((p) => stepPartOf(p as unknown as Parameters<typeof stepPartOf>[0], ctxOf(jobId, j.status))) })} />;
  };
  const tone = (sinceIso: string) => {
    const min = workingMinutesSince(sinceIso, wt);
    return { min, tone: min >= target * 120 ? "red" : min >= target * 60 ? "amber" : "neutral" } as const;
  };

  // Section 10 (3 November 2026): ONE rule for the to-do list (pricingTodoOf). A car is to price while a request is open
  // or a part is not priced (also after "Send what you have": those lines stay the desk's); "priced – send to the
  // advisor" while a send is expected and something waits for it; off the list once sent; back on it when a new part
  // arrives (the pricing reopens).
  const todoOf = new Map<string, "to_price" | "to_send">();
  for (const j of jobs.values()) {
    const t = pricingTodoOf(j, requests.filter((r) => r.job_id === j.id), parts.filter((p) => p.job_id === j.id));
    if (t) todoOf.set(j.id, t);
  }
  const toPriceJobs = Array.from(todoOf.entries()).filter(([, t]) => t === "to_price").map(([id]) => id);
  const toSendJobs = Array.from(todoOf.entries()).filter(([, t]) => t === "to_send").map(([id]) => id);
  const toPrice = requests.filter((r) => todoOf.get(r.job_id) === "to_price" && r.status === "open");
  const waitingPrice = parts.filter((p) => todoOf.get(p.job_id) === "to_price" && p.cost_aed === null && p.confirm_status !== "rejected" && p.order_status === "none");
  const toOrder = parts.filter((p) => jobs.has(p.job_id) && p.order_status === "to_order" && !p.po_id);
  // Deliveries expected = genuinely ordered. A part on a pending LPO sits under Waiting for owner approval; on an approved one it is ORDER NOW.
  const ordered = parts.filter((p) => jobs.has(p.job_id) && (p.order_status === "ordered" || p.order_status === "partly_received"));
  const toIssue = parts.filter((p) => jobs.has(p.job_id) && p.order_status === "received" && p.issue_status !== "confirmed" && p.return_status === "none");
  const byJob = (items: { job_id: string }[]) => Array.from(new Set(items.map((i) => i.job_id)));
  // All cars: every open job with any part, newest first. The search: plate, job number, VIN or customer, closed jobs included.
  const { data: partJobRows } = await admin.from("part_items").select("job_id");
  const partJobIds = Array.from(new Set((partJobRows ?? []).map((r) => r.job_id as string)));
  const { data: allRows } = partJobIds.length ? await admin.from("jobs").select(ALL_JOB_SELECT).in("id", partJobIds).eq("is_open", true).order("gated_in_at", { ascending: false }) : { data: [] as unknown[] };
  const allCars = (allRows ?? []) as unknown as AllJob[];
  let found: AllJob[] = [];
  if (q) {
    const like = `%${q.replace(/[%_,()]/g, " ").trim()}%`;
    const [{ data: vj }, { data: cj }, { data: nj }] = await Promise.all([
      admin.from("vehicles").select("id").or(`plate_number.ilike.${like},vin.ilike.${like}`).limit(60),
      seesCust ? admin.from("customers").select("id").or(`full_name.ilike.${like},company_name.ilike.${like}`).limit(60) : Promise.resolve({ data: [] as { id: string }[] }),
      admin.from("jobs").select("id").ilike("job_number", like).limit(60),
    ]);
    const ors = [
      (nj ?? []).length ? `id.in.(${(nj ?? []).map((j) => j.id).join(",")})` : "",
      (vj ?? []).length ? `vehicle_id.in.(${(vj ?? []).map((v) => v.id).join(",")})` : "",
      (cj ?? []).length ? `customer_id.in.(${(cj ?? []).map((c) => c.id).join(",")})` : "",
    ].filter(Boolean);
    if (ors.length) {
      const { data } = await admin.from("jobs").select(ALL_JOB_SELECT).or(ors.join(",")).order("gated_in_at", { ascending: false }).limit(40);
      found = (data ?? []) as unknown as AllJob[];
    }
  }
  const advisorOfCars = await jobAdvisorsFor([...allCars, ...found].map((j) => j.id));
  for (const [k, a] of advisorOfCars) {
    advisorOf.set(k, a);
    if (a.advisorId && a.advisorName) advisorNames.set(a.advisorId, a.advisorName);
  }
  for (const [k, t] of await jobTechniciansFor([...allCars, ...found].map((j) => j.id))) techOf.set(k, t);
  for (const t of techOf.values()) for (const x of [...t.mechanical, ...t.bodyshop]) if (x.name) techNames.set(x.id, x.name);
  const allShown = allCars.filter((j) => (!advisorFilter || advisorOf.get(j.id)?.advisorId === advisorFilter) && (!techFilter || onCar(techOf.get(j.id), techFilter)));
  const foundShown = found.filter((j) => (!advisorFilter || advisorOf.get(j.id)?.advisorId === advisorFilter) && (!techFilter || onCar(techOf.get(j.id), techFilter)));
  const pics = await signCarPictures([...allCars, ...found].map((j) => j.vehicle?.photo_path));
  const tagOf = (jobId: string) => {
    const a = advisorOf.get(jobId);
    const j = jobs.get(jobId) ?? allCars.find((x) => x.id === jobId) ?? found.find((x) => x.id === jobId);
    const plate = j?.vehicle ? formatPlate(j.vehicle as Parameters<typeof formatPlate>[0]) : "";
    return (
      <>
        {a ? <JobAdvisorTag jobId={jobId} jobWords={`${j?.job_number ?? ""}${plate ? ` · ${plate}` : ""}`} advisor={a} canAsk={!staff.viewingAs} /> : null}
        <JobTechnicianTag jobId={jobId} technicians={techOf.get(jobId)} />
      </>
    );
  };
  const carRow = (j: AllJob) => {
    const steps = partsSteps({ jobStatus: j.status, pricingDoneAt: j.parts_pricing_done_at, pricingReopenedAt: j.parts_pricing_reopened_at, parts: parts.filter((p) => p.job_id === j.id).map((p) => stepPartOf(p as unknown as Parameters<typeof stepPartOf>[0], ctxOf(j.id, j.status))) });
    const allDone = steps.every((s) => s.state === "done");
    const gone = !j.is_open;
    const car = [j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ");
    return (
      <div key={j.id} className={`flex flex-wrap items-center gap-3 rounded-card border px-3 py-2 min-h-12 ${gone ? "border-line bg-chip" : allDone ? "border-green bg-green-soft" : "border-line bg-white"}`} data-all-car={j.id} data-all-done={allDone && !gone ? "1" : undefined} data-gone={gone ? "1" : undefined}>
        <Link href={`/parts/${j.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
          <CarThumb size="sm" url={j.vehicle?.photo_path ? (pics.get(j.vehicle.photo_path) ?? null) : null} alt={j.vehicle ? formatPlate(j.vehicle) : j.job_number} />
          <span className="font-extrabold uppercase">{j.vehicle ? formatPlate(j.vehicle) : "—"}</span>
          <span className="text-sm uppercase">{car}</span>
          <span className="text-sm text-muted">{j.job_number}</span>
          {seesCust && j.customer ? <span className="text-sm text-muted uppercase">{j.customer.company_name ?? j.customer.full_name}</span> : null}
          <PartsSteps size="dots" steps={steps} />
          <span className={`ml-auto text-xs font-semibold ${allDone && !gone ? "text-green" : "text-muted"}`}>{gone ? `Gated out${j.gated_out_at ? ` ${formatDate(j.gated_out_at)}` : ""}` : allDone ? "All parts handed over" : (STATUS_LABELS[j.status as JobStatus] ?? j.status)}</span>
        </Link>
        {tagOf(j.id)}
        <Link href={`/jobs/${j.id}/inspection`} className="inline-flex min-h-9 items-center text-xs font-semibold underline underline-offset-4" data-view-inspection={j.id}>
          View inspection
        </Link>
      </div>
    );
  };

  return (
    <>
      <LiveRefresh tables={["part_requests", "part_items", "jobs"]} />
      <PageHeader
        title="Parts"
        subtitle="To price, to order, deliveries expected, received to issue."
        actions={
          <>
            <LinkButton href="/parts/inspections" tone="secondary" size="lg" data-inspection-list-link>Inspection reports</LinkButton>
            <LinkButton href="/parts/no-home" tone="secondary" size="lg" data-returns-tab>Returns and leftovers{noHomeCount ? ` (${noHomeCount})` : ""}</LinkButton>
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <WaitingPanel staff={staff} />
      <PricesToFix rows={await pricesToFix()} />

      <form method="get" className="flex flex-wrap items-center gap-2" data-parts-search-form>
        <Input name="q" defaultValue={q} placeholder={seesCust ? "Find a car: plate, job number, VIN or customer (gone-out cars too)" : "Find a car: plate, job number or VIN (gone-out cars too)"} aria-label="Find a car" className="min-w-64 flex-1" data-parts-search />
        <Button type="submit" size="md" tone="secondary">Search</Button>
        {advisorFilter ? <input type="hidden" name="advisor" value={advisorFilter} /> : null}
        {q ? <LinkButton href={advisorFilter ? `/parts?advisor=${advisorFilter}` : "/parts"} tone="ghost" size="md">Clear</LinkButton> : null}
      </form>
      {techNames.size ? (
        <nav className="flex flex-wrap items-center gap-2" aria-label="Technician filter" data-tech-filter-bar>
          <span className="text-sm font-bold">Technician:</span>
          {[["", "All"] as [string, string], ...Array.from(techNames.entries()).sort((a, b) => a[1].localeCompare(b[1]))].map(([id, name]) => {
            const params = new URLSearchParams();
            if (q) params.set("q", q);
            if (advisorFilter) params.set("advisor", advisorFilter);
            if (id) params.set("tech", id);
            const query = params.toString();
            return (
              <Link key={id || "all"} href={`/parts${query ? `?${query}` : ""}`} aria-current={techFilter === id ? "true" : undefined} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${techFilter === id ? "border-ink bg-ink text-white" : "border-line bg-white"}`} data-tech-filter={id || "all"}>
                {name}
              </Link>
            );
          })}
        </nav>
      ) : null}
      {advisorNames.size ? (
        <nav className="flex flex-wrap items-center gap-2" aria-label="Advisor filter" data-advisor-filter-bar>
          <span className="text-sm font-bold">Advisor:</span>
          {[["", "All"] as [string, string], ...Array.from(advisorNames.entries()).sort((a, b) => a[1].localeCompare(b[1]))].map(([id, name]) => {
            const on = advisorFilter === id;
            const params = new URLSearchParams();
            if (q) params.set("q", q);
            if (id) params.set("advisor", id);
            const query = params.toString();
            return (
              <Link key={id || "all"} href={`/parts${query ? `?${query}` : ""}`} aria-current={on ? "true" : undefined} className={`inline-flex min-h-9 items-center rounded-full border px-3 text-sm font-semibold ${on ? "border-ink bg-ink text-white" : "border-line bg-white"}`} data-advisor-filter={id || "all"}>
                {name}
              </Link>
            );
          })}
        </nav>
      ) : null}
      {q ? (
        <section className="flex flex-col gap-2" data-search-results>
          <SectionLabel right={`${foundShown.length}`}>Cars matching &quot;{q}&quot;</SectionLabel>
          {foundShown.length === 0 ? <p className="text-sm text-muted">No car found. Try the plate number, the job number, the VIN or the customer&apos;s name.</p> : foundShown.map(carRow)}
        </section>
      ) : null}

      {orderNowShown.length ? (
        <section className="flex flex-col gap-3" data-order-now-section>
          <SectionLabel right={`${orderNowShown.length}`}>Order now <span className="cursor-help font-normal text-muted" title={`Approved: send each supplier LPO (Copy, PDF or Email) and press Ordered. Amber past ${amberMin} working minutes, red past ${redMin} - the owner is told once.`}>ⓘ</span></SectionLabel>
          {orderNowShown.map((po) => {
            const lines = onLines.get(po.id) ?? [];
            const j = po.job_id ? jobs.get(po.job_id) : undefined;
            const mins = po.approved_at ? workingMinutesSince(po.approved_at, wt) : 0;
            const toneCls = mins >= redMin ? "!border-red-bar" : mins >= amberMin ? "!border-amber-bar" : "border-ink";
            return (
              <Card key={po.id} className={`flex flex-col gap-2 border-2 ${toneCls}`} data-order-now={po.number} data-order-tone={mins >= redMin ? "red" : mins >= amberMin ? "amber" : "fresh"}>
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  <span className={`text-base font-extrabold ${mins >= redMin ? "text-red" : ""}`}>ORDER NOW</span>
                  {j ? <span className="font-bold uppercase">{j.vehicle ? formatPlate(j.vehicle) : j.job_number}</span> : <span className="font-bold">Stock order</span>}
                  {j ? <span className="uppercase">{[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")}</span> : null}
                  {po.job_id ? tagOf(po.job_id) : null}
                  <span className="text-muted">· {po.supplier_name} · {lines.length} part{lines.length === 1 ? "" : "s"}</span>
                  <span className={`ml-auto text-xs font-bold ${mins >= redMin ? "text-red" : mins >= amberMin ? "text-amber-bar" : "text-muted"}`} data-order-wait>Approved{po.approved_by ? ` by ${approverName.get(po.approved_by) ?? ""}` : ""}{po.approved_at ? ` ${formatDayTime(po.approved_at)}` : ""} · waiting {formatWait(mins, wt)}</span>
                </span>
                <SupplierLpoCard po={{ id: po.id, number: po.number, chargesVat: vatOf(po.supplier_id ?? null, po.supplier_name), supplier_name: po.supplier_name, status: po.status, ordered_at: po.ordered_at, verify_token: po.verify_token, sent_at: po.sent_at, emailed_at: po.emailed_at, emailed_to: po.emailed_to, total_cost_aed: po.total_cost_aed, lines: lines.map((l) => ({ id: l.id, part_item_id: l.part_item_id, description: l.description, positions: parts.find((x) => x.id === l.part_item_id)?.positions ?? null, unit: unitOfPart.get(l.part_item_id) ?? null, part_number: l.part_number, quantity: l.quantity, unit_cost: l.unit_cost, expected_date: l.expected_date, received_qty: l.received_qty })), charges: onCharges.get(po.id) ?? [] }} vin={j?.vehicle?.vin ?? null} canManage={!staff.viewingAs} onOrdered={markSupplierOrdered.bind(null, po.id)} onSetDate={setPartExpectedDate} supplierEmail={po.supplier_id ? (supplierEmail.get(po.supplier_id) ?? null) : null} emailReady={gmailConfigured()} onEmail={emailSupplierLpo.bind(null, po.id)} jobId={po.job_id} />
              </Card>
            );
          })}
        </section>
      ) : null}

      {estimatesShown.length ? (
        <section className="flex flex-col gap-3" data-estimates-to-price={estimatesShown.length}>
          <SectionLabel right={`${estimatesShown.length}`}>Estimates to price <span className="cursor-help font-normal text-muted" title="An advisor's estimate before the car arrives: price each part he named. A price the advisor typed himself is marked Priced by advisor: check it.">ⓘ</span></SectionLabel>
          {estimatesShown.map((e) => (
            <Card key={e.id} className={`flex flex-wrap items-center justify-between gap-3 ${e.toPrice ? "!border-amber-bar" : ""}`} data-estimate-to-price={e.number}>
              <span className="flex min-w-0 flex-col gap-0.5">
                <Link href={`/parts/estimate/${e.id}`} className="font-extrabold hover:underline underline-offset-4">ESTIMATE {e.number} – car not here yet</Link>
                <span className="text-sm"><span className="font-bold">{e.plate}</span> · {e.car}{e.advisor ? <span className="text-muted"> · Advisor {e.advisor}</span> : null}</span>
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-amber">{estimateTaskWords(e)}{e.vin ? <CopyVin vin={e.vin} /> : <span className="text-xs font-normal text-muted">VIN not known yet</span>}</span>
              </span>
              <LinkButton href={`/parts/estimate/${e.id}#pricing`} size="md" data-estimate-price-open>{e.toPrice ? "Price the parts" : "Send to advisor"}</LinkButton>
            </Card>
          ))}
        </section>
      ) : null}

      {toSendJobs.length ? (
        <section className="flex flex-col gap-3" data-to-send-section={toSendJobs.length}>
          <SectionLabel right={`${toSendJobs.length}`}>Priced – send to the advisor <span className="cursor-help font-normal text-muted" title="Every part on these cars is priced, but Pricing done – send to advisor was not pressed: the advisor does not know yet.">ⓘ</span></SectionLabel>
          {toSendJobs.map((jobId) => (
            <Card key={jobId} className="flex flex-wrap items-center gap-3 !border-ink" data-to-send-car={jobId}>
              <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/${jobId}#pricing`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{tagOf(jobId)}{dotsOf(jobId)}</span>
              <span className="text-sm font-semibold text-amber">{jobs.get(jobId)?.parts_pricing_reopened_at && jobs.get(jobId)?.parts_pricing_done_at ? "Changed since you sent it" : "Ready to send – the advisor does not know yet"}</span>
              <LinkButton href={`/parts/${jobId}#pricing`} size="md" className="ml-auto" data-to-send-open>Send to advisor</LinkButton>
            </Card>
          ))}
        </section>
      ) : null}

      {toPriceJobs.length ? (
      <section className="flex flex-col gap-3" data-to-price-section={toPriceJobs.length}>
        <SectionLabel right={`${toPriceJobs.length}`}>To price <span className="cursor-help font-normal text-muted" title={`What the technician asked for on the approved report. Target: ${target} working hours, amber past it, red at double. A car leaves this list when you press Pricing done – send to advisor.`}>ⓘ</span></SectionLabel>
        {toPriceJobs.filter((jobId) => toPrice.some((r) => r.job_id === jobId) || !waitingPrice.some((p) => p.job_id === jobId)).map((jobId) => {
          const rows = toPrice.filter((r) => r.job_id === jobId);
          const oldest = rows.map((r) => r.created_at).sort()[0] ?? parts.filter((p) => p.job_id === jobId).map((p) => p.created_at).sort()[0];
          const t = tone(oldest);
          return (
            <Card key={jobId} className={`flex flex-col gap-1 ${t.tone === "red" ? "!border-red-bar" : t.tone === "amber" ? "!border-amber-bar" : ""}`} data-to-price-car={jobId}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{tagOf(jobId)}{dotsOf(jobId)}<CopyVin vin={jobs.get(jobId)?.vehicle?.vin} /></span>
                <span className="flex items-center gap-2"><Badge tone={t.tone === "neutral" ? "outline" : t.tone}>waiting {formatWait(t.min, wt)}</Badge><LinkButton href={`/parts/${jobId}`} size="md">Price the parts</LinkButton></span>
              </div>
              {rows.length ? <details>
                <summary className="cursor-pointer text-sm font-semibold text-muted">{rows.length} request{rows.length === 1 ? "" : "s"}</summary>
                <ul className="text-sm divide-y divide-line">
                  {rows.map((r) => (
                    <li key={r.id} className="py-1.5"><span className="font-semibold">{r.label}</span>{r.requested_text ? <span className="text-muted"> · {r.requested_text}</span> : null}</li>
                  ))}
                </ul>
              </details> : <span className="text-sm text-muted">Parts not finished: open the car to finish them.</span>}
            </Card>
          );
        })}
        {waitingPrice.length ? (
          <details className="rounded-card border border-line bg-white px-4 py-2">
            <summary className="min-h-10 cursor-pointer text-sm font-bold">Waiting for a price · {waitingPrice.length}</summary>
            {byJob(waitingPrice).map((jobId) => (
              <div key={jobId} className="flex flex-col gap-1 border-t border-line py-2">
                <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{tagOf(jobId)}{dotsOf(jobId)}</span>
                <ul className="text-sm divide-y divide-line">
                  {waitingPrice.filter((p) => p.job_id === jobId).map((p) => (
                    <li key={p.id} className="py-1.5">{p.description}{realPartNumber(p.part_number) ? <span className="text-muted"> · {realPartNumber(p.part_number)}</span> : null} · × {p.confirmed_quantity ?? p.quantity}</li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
        ) : null}
      </section>
      ) : null}

      {toOrder.length ? (
      <section className="flex flex-col gap-3">
        <SectionLabel right={`${toOrder.length}`}>Send LPO for approval <span className="cursor-help font-normal text-muted" title="The customer approved these parts. One button on the car's page sends the LPO; the owner or accounts approve it with one tap.">ⓘ</span></SectionLabel>
        {byJob(toOrder).map((jobId) => {
          const items = toOrder.filter((p) => p.job_id === jobId);
          const total = items.reduce((a, p) => a + (p.cost_aed ?? 0) * (Number(p.confirmed_quantity ?? p.quantity) || 1), 0);
          const supplierSet = Array.from(new Set(items.map((p) => (p.supplier ?? "").trim()).filter(Boolean)));
          return (
            <Card key={jobId} className="flex flex-wrap items-center gap-3">
              <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/${jobId}#lpo`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{tagOf(jobId)}{dotsOf(jobId)}<CopyVin vin={jobs.get(jobId)?.vehicle?.vin} /></span>
              <span className="text-sm text-muted">{items.length} part{items.length === 1 ? "" : "s"} · {supplierSet.length ? `${supplierSet.length} supplier${supplierSet.length === 1 ? "" : "s"}` : "no supplier yet"} · AED {total.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
              <LinkButton href={`/parts/${jobId}#lpo`} size="md" className="ml-auto">Send LPO for approval</LinkButton>
            </Card>
          );
        })}
      </section>
      ) : null}

      {pendingShown.length ? (
        <section className="flex flex-col gap-3" data-pending-approval-section>
          <SectionLabel right={`${pendingShown.length}`}>Waiting for owner approval <span className="cursor-help font-normal text-muted" title="Sent for approval; the owner or the head accountant approve with one tap on the LPO page.">ⓘ</span></SectionLabel>
          {pendingShown.map((po) => {
            const j = po.job_id ? jobs.get(po.job_id) : undefined;
            return (
              <Card key={po.id} className="flex flex-wrap items-center gap-3">
                <span className="font-extrabold">{po.number}</span>
                {j ? <span className="uppercase">{j.vehicle ? formatPlate(j.vehicle) : j.job_number}</span> : <span>Stock order</span>}
                {po.job_id ? tagOf(po.job_id) : null}
                <span className="text-sm text-muted">{po.kind === "main" ? "every supplier" : po.supplier_name} · AED {po.total_cost_aed.toLocaleString("en-GB", { minimumFractionDigits: 2 })}</span>
                <LinkButton href={`/parts/orders/${po.id}`} size="md" tone="secondary" className="ml-auto">Open the LPO</LinkButton>
              </Card>
            );
          })}
        </section>
      ) : null}

      {ordered.length ? (
        <section className="flex flex-col gap-3" data-deliveries-section>
          <SectionLabel right={`${ordered.length}`}>Deliveries expected <span className="cursor-help font-normal text-muted" title="Grouped per supplier with the expected dates; anything past its date shows red. Receiving is on each LPO.">ⓘ</span></SectionLabel>
          {Array.from(new Set(ordered.map((p) => (p.supplier ?? "").trim() || "No supplier"))).sort().map((sup) => {
            const items = ordered.filter((p) => ((p.supplier ?? "").trim() || "No supplier") === sup);
            const overdue = items.filter((p) => !!p.expected_date && p.expected_date < today);
            const nextDate = items.map((p) => p.expected_date).filter(Boolean).sort()[0] ?? null;
            return (
              <details key={sup} className={`rounded-card border bg-white px-4 py-2 ${overdue.length ? "border-red-bar" : "border-line"}`} data-supplier-group={sup}>
                <summary className="min-h-11 cursor-pointer flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-extrabold">{sup}</span>
                  <span className="text-muted">{items.length} part{items.length === 1 ? "" : "s"}</span>
                  {overdue.length ? <Badge tone="red">{overdue.length} overdue</Badge> : nextDate ? <Badge tone="neutral">next {formatDate(nextDate)}</Badge> : null}
                </summary>
                <ul className="text-sm divide-y divide-line">
                  {items.map((p) => {
                    const late = !!p.expected_date && p.expected_date < today;
                    return (
                      <li key={p.id} className="py-1.5 flex flex-wrap items-center gap-2">
                        <Link href={`/parts/${p.job_id}#received`} className="font-semibold hover:underline underline-offset-4">{jobs.get(p.job_id)?.vehicle ? formatPlate(jobs.get(p.job_id)!.vehicle!) : jobs.get(p.job_id)?.job_number}</Link>
                        <span>{p.description}</span>
                        <span className="text-muted">× {p.confirmed_quantity ?? p.quantity}</span>
                        <Badge tone={late ? "red" : p.order_status === "partly_received" ? "amber" : "neutral"}>{late ? `Late · expected ${formatDate(p.expected_date!)}` : p.order_status === "partly_received" ? "Partly received" : p.expected_date ? `expected ${formatDate(p.expected_date)}` : "no date"}</Badge>
                      </li>
                    );
                  })}
                </ul>
              </details>
            );
          })}
        </section>
      ) : null}

      {toIssue.length ? (
        <section className="flex flex-col gap-3" data-handover-section>
          <SectionLabel right={`${toIssue.length}`}>Received, to hand over <span className="cursor-help font-normal text-muted" title="At the desk: mark them ready; the technician receives them on his tablet with his PIN.">ⓘ</span></SectionLabel>
          {byJob(toIssue).map((jobId) => (
            <Card key={jobId} className="flex flex-wrap items-center gap-3">
              <span className="flex flex-wrap items-center gap-2"><Link href={`/parts/handover/${jobId}`} className="font-extrabold hover:underline underline-offset-4">{jobLine(jobId)}</Link>{tagOf(jobId)}{dotsOf(jobId)}</span>
              <span className="text-sm text-muted">{toIssue.filter((p) => p.job_id === jobId).length} part{toIssue.filter((p) => p.job_id === jobId).length === 1 ? "" : "s"} ready</span>
              <LinkButton href={`/parts/handover/${jobId}`} size="md" className="ml-auto">Hand over</LinkButton>
            </Card>
          ))}
        </section>
      ) : null}

      <details data-all-cars-fold>
        <summary className="min-h-11 cursor-pointer text-sm font-extrabold uppercase tracking-[0.08em]" data-all-cars-summary>All cars ({allShown.length})</summary>
        <section className="flex flex-col gap-2 pt-2" data-all-cars>
          {allShown.length === 0 ? <p className="text-sm text-muted">No open car has parts yet.</p> : allShown.map(carRow)}
        </section>
      </details>
    </>
  );
}

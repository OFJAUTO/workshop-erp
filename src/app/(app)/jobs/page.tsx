import { cookies } from "next/headers";
import { CarCard } from "@/components/CarCard";
import { JobListControls } from "@/components/JobListControls";
import { RecentJobsStrip } from "@/components/RecentJobs";
import { jobCustomersFor, jobPeopleFor } from "@/lib/customer-data";
import { PriorityBadge, TimingBadge } from "@/components/JobBadges";
import { Badge, Empty, LinkButton, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { signCarPictures } from "@/lib/car-pictures";
import { formatDate } from "@/lib/format";
import { DEFAULT_JOB_FILTERS, applyJobList, filtersNarrow, hasListParams, jobFilterQuery, jobListCookie, readJobFilters, shownWords, type JobListItem } from "@/lib/job-list";
import { STAGES, STAGE_LABELS, STATUS_LABELS, clockOf, hoursInStage, jobTiming } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatPlate, type JobRow } from "@/lib/types";

type Row = JobRow & {
  advisor_id: string | null;
  vehicle: { photo_path: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; variant: string | null; model_year: number | null; make: { name: string } | null; model: { name: string } | null } | null;
};

/**
 * The jobs list (6 November 2026, Section 6): newest opened first by default; sorts, filters, search and the
 * recently viewed strip through THE list rule (`src/lib/job-list.ts`). Each person's choice is remembered.
 */
export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requirePermission("viewJobs");
  const params = await searchParams;
  const closed = params.show === "closed";
  const role = staff.role_id as RoleId;
  const settings = await getSettings();

  // The address wins; with none, this person's remembered choice; "Clear all" (reset) starts from the default.
  const cookieName = jobListCookie(staff.id);
  const remembered = (await cookies()).get(cookieName)?.value;
  const filters = hasListParams(params) || params.reset ? readJobFilters(params) : remembered ? readJobFilters(Object.fromEntries(new URLSearchParams(safeDecode(remembered)))) : DEFAULT_JOB_FILTERS;

  const supabase = await createClient();
  const { data } = await supabase
    .from("jobs")
    .select(
      "id, job_number, job_kind, vehicle_id, customer_id, stage, status, priority, promised_at, assigned_to, assigned_at, gated_in_at, gated_in_by, gated_out_at, gated_out_by, first_approval_at, stage_entered_at, is_open, department, advisor_id, created_at, updated_at, vehicle:vehicles(kind, photo_path, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, variant, model_year, make:vehicle_makes(name), model:vehicle_models(name))",
    )
    .eq("is_open", !closed)
    .order(closed ? "gated_out_at" : "gated_in_at", { ascending: false })
    .limit(closed ? 200 : 500);
  const all = (data ?? []) as unknown as Row[];
  const ids = all.map((j) => j.id);
  const { data: techRows } = ids.length ? await supabase.from("job_technicians").select("job_id, staff_id").in("job_id", ids) : { data: [] };
  const techsOf = new Map<string, string[]>();
  for (const t of (techRows ?? []) as { job_id: string; staff_id: string }[]) techsOf.set(t.job_id, [...(techsOf.get(t.job_id) ?? []), t.staff_id]);
  const now = new Date();
  const items: JobListItem[] = all.map((j) => {
    const clock = clockOf(j, settings);
    const timing = jobTiming(j.promised_at, j.is_open, clock, now);
    const v = j.vehicle;
    const plate = v ? formatPlate(v) : "";
    return {
      id: j.id,
      openedAt: j.gated_in_at ?? j.created_at,
      promisedAt: j.promised_at,
      stage: j.stage,
      status: j.status,
      priority: j.priority,
      department: j.department ?? null,
      advisorId: j.advisor_id ?? null,
      techIds: techsOf.get(j.id) ?? [],
      overdue: j.is_open && timing.tone === "red",
      hoursInStage: j.is_open ? hoursInStage(clock, now) : 0,
      search: [j.job_number, plate, v?.plate_code, v?.plate_number, v?.vin, v?.make?.name, v?.model?.name, v?.variant].filter(Boolean).join(" "),
    };
  });
  const listed = applyJobList(items, filters, now, STAGES);
  const byId = new Map(all.map((j) => [j.id, j]));
  const rows = listed.map((i) => byId.get(i.id)!);

  // The drop-down choices: only the advisors and technicians on these cars (names through the narrow staff read).
  const advisorIds = Array.from(new Set(items.map((i) => i.advisorId).filter((x): x is string => !!x)));
  const techIds = Array.from(new Set(items.flatMap((i) => i.techIds)));
  const people = advisorIds.length + techIds.length ? ((await createAdminClient().from("staff").select("id, display_name").in("id", [...advisorIds, ...techIds])).data ?? []) : [];
  const nameOf = new Map((people as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  const byName = (a: { label: string }, b: { label: string }) => a.label.localeCompare(b.label);
  const advisors = advisorIds.map((id) => ({ value: id, label: nameOf.get(id) ?? "Advisor" })).sort(byName);
  const technicians = techIds.map((id) => ({ value: id, label: nameOf.get(id) ?? "Technician" })).sort(byName);
  const stages = STAGES.filter((s) => items.some((i) => i.stage === s)).map((s) => ({ value: s, label: STAGE_LABELS[s] }));

  const [pictures, jobCustomers, jobPeople] = await Promise.all([signCarPictures(rows.map((j) => j.vehicle?.photo_path)), jobCustomersFor(role, rows.map((j) => j.id)), jobPeopleFor(rows.map((j) => j.id))]);
  const narrowed = filtersNarrow(filters);

  return (
    <>
      <PageHeader
        title={closed ? "Closed jobs" : "Open jobs"}
        subtitle={shownWords(rows.length, items.length, narrowed)}
        actions={
          <>
            <LinkButton href={closed ? "/jobs" : "/jobs?show=closed"} tone="secondary">
              {closed ? "Show open" : "Show closed"}
            </LinkButton>
            {can(role, "gateIn") ? <LinkButton href="/gate-in">Gate in a car</LinkButton> : null}
            {can(role, "gateIn") ? <LinkButton href="/gate-in/loose" tone="secondary">Loose items</LinkButton> : null}
          </>
        }
      />
      <div className="mb-3 flex flex-col gap-3">
        <RecentJobsStrip staffId={staff.id} />
        <JobListControls
          basePath="/jobs"
          keep={closed ? { show: "closed" } : {}}
          filters={filters}
          stages={stages}
          advisors={advisors}
          technicians={technicians}
          shown={shownWords(rows.length, items.length, narrowed)}
          staffCookie={cookieName}
          rememberQuery={jobFilterQuery(filters)}
        />
      </div>
      {rows.length === 0 ? (
        <Empty title={items.length ? "No job matches these filters" : closed ? "No closed jobs yet" : "No cars in the workshop"} />
      ) : (
        <div className="flex flex-col gap-3" data-job-list>
          {rows.map((j) => {
            const timing = jobTiming(j.promised_at, j.is_open, clockOf(j, settings), now);
            return (
              <CarCard
                key={j.id}
                href={`/jobs/${j.id}`}
                pictureUrl={j.vehicle?.photo_path ? (pictures.get(j.vehicle.photo_path) ?? null) : null}
                plate={j.vehicle ? formatPlate(j.vehicle) : "?"}
                title={[j.vehicle?.make?.name, j.vehicle?.model?.name, j.vehicle?.variant, j.vehicle?.model_year].filter(Boolean).join(" ")}
                customer={jobCustomers.has(j.id) ? { name: jobCustomers.get(j.id)!.name, jobId: j.id, contact: jobCustomers.get(j.id)!.contact, arrived: jobCustomers.get(j.id)!.arrived } : null}
                staffNames={jobPeople.get(j.id) ?? []}
                sub={[j.job_number, closed ? `Out ${formatDate(j.gated_out_at)}` : `In ${formatDate(j.gated_in_at ?? j.created_at)}`]}
                chips={
                  <>
                    {j.job_kind === "loose" ? <Badge tone="ink">Loose items</Badge> : null}
                    <PriorityBadge priority={j.priority} />
                    <TimingBadge timing={timing} />
                    {!j.is_open ? <Badge>Closed</Badge> : null}
                  </>
                }
                status={{ line: STATUS_LABELS[j.status] }}
                stage={{ stage: j.stage, timing, skip: j.job_kind === "loose" ? ["inspection", "wash"] : undefined }}
              />
            );
          })}
        </div>
      )}
    </>
  );
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

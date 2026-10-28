import Link from "next/link";
import { redirect } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { ProblemButton } from "@/components/ProblemButton";
import { StageHandover } from "@/components/StageHandover";
import { StaffPicker } from "@/components/StaffPicker";
import { requireStaff } from "@/lib/auth";
import { SECTIONS, SECTION_LABELS, sectionOfDepartment, type Section } from "@/lib/bodyshop-kinds";
import { loadBoard, sectionCars, type BoardCar } from "@/lib/bodyshop";
import { formatDate } from "@/lib/format";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { pickablePeople } from "@/lib/staff-picker";
import { createAdminClient } from "@/lib/supabase/admin";
import { bodyshopScopeOf, maySignAftercare } from "@/lib/team-scope";
import { TEAM_LABELS, TEAM_OF_SECTION } from "@/lib/teams";
import { formatPlate } from "@/lib/types";
import { signJobFiles } from "@/lib/work-data";
import { assignAction, clockAction, handOverStageAction, raiseProblemAction } from "../actions";
import { mayPickPerson } from "@/lib/team-scope";
import { rowMissing, stageAsks, warrantyCardOf } from "@/lib/warranty-data";
import { FALLBACK_POLL_MS } from "@/lib/live-connection";

export const dynamic = "force-dynamic";

type Group = "overdue" | "ready" | "progress" | "waiting";
const GROUPS: { key: Group; title: string; empty: string }[] = [
  { key: "overdue", title: "Overdue", empty: "Nothing overdue." },
  { key: "ready", title: "Ready for us", empty: "No car is waiting for your team to start." },
  { key: "progress", title: "In progress", empty: "Nobody of your team is clocked on a car." },
  { key: "waiting", title: "Waiting (coming to us)", empty: "Nothing on its way." },
];

/**
 * A team leader's screen (28 October 2026, B2): their team's queue in four groups - overdue, ready for us (the car
 * is with the team, nobody clocked on), in progress (someone clocked on), waiting (coming later) - with "My team now"
 * (clocked on, on break, free) on top. On each car: the team's people (one tap), clock me on or off, the stage
 * hand-over with photos and PIN, and "Problem – needs manager". Only their own team, on screen and on the server.
 */
export default async function MySectionPage({ searchParams }: { searchParams: Promise<{ section?: string; message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!can(role, "leadSection") || !can(role, "viewBodyshop")) redirect("/home");
  const { section: q, message, error } = await searchParams;
  const scope = bodyshopScopeOf(staff);
  const own = scope.kind === "team" ? scope.section : sectionOfDepartment(staff.department_id);
  const section = ((role === "team_leader" ? own : (q as Section | undefined) ?? own) ?? "ppf") as Section;
  if (!SECTIONS.includes(section)) redirect("/bodyshop");
  const settings = await getSettings();
  const [board, everyone] = await Promise.all([loadBoard(), pickablePeople(settings, ["bodyshop"])]);
  const { now, coming } = sectionCars(board.cars, section);
  // THE shared picker's people: this section's team, the leader first and marked.
  const team = TEAM_OF_SECTION[section];
  const mine = everyone.filter((p) => p.team === team);
  const canAct = !staff.viewingAs && scope.kind !== "none";
  const admin = createAdminClient();
  const jobIds = [...now, ...coming].map((c) => c.job.id);
  const stageIds = now.map((c) => c.current?.id).filter((x): x is string => !!x);
  const [{ data: openClk }, { data: probs }, { data: photoRows }, { data: careRows }] = await Promise.all([
    jobIds.length ? admin.from("bodyshop_clockings").select("job_id, staff_id").in("job_id", jobIds).is("ended_at", null).eq("is_active", true) : Promise.resolve({ data: [] as { job_id: string; staff_id: string }[] }),
    jobIds.length ? admin.from("bodyshop_problems").select("id, job_id, text, answer, answered_at, created_at").in("job_id", jobIds).eq("is_active", true).order("created_at", { ascending: false }) : Promise.resolve({ data: [] as { id: string; job_id: string; text: string; answer: string | null; answered_at: string | null; created_at: string }[] }),
    stageIds.length ? admin.from("job_files").select("id, ref_id, storage_path, content_type, caption").eq("kind", "bodyshop_photo").in("ref_id", stageIds).is("removed_at", null).order("created_at") : Promise.resolve({ data: [] as { id: string; ref_id: string; storage_path: string; content_type: string | null; caption: string | null }[] }),
    maySignAftercare(scope) && section === "ppf" ? admin.from("aftercare_checks").select("id, job_id, due_date, job:jobs(job_number, gated_out_at, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin))").eq("is_active", true).is("done_at", null).is("activated_at", null).order("due_date") : Promise.resolve({ data: [] }),
  ]);
  const clockedOn = (jobId: string) => (openClk ?? []).filter((c) => c.job_id === jobId).map((c) => c.staff_id);
  const urls = await signJobFiles((photoRows ?? []).map((f) => f.storage_path));
  const photosOf = (stageId: string) => (photoRows ?? []).filter((f) => f.ref_id === stageId).map((f) => ({ id: f.id, path: f.storage_path, url: urls[f.storage_path] ?? null, caption: f.caption, contentType: f.content_type }));
  const today = board.today;
  // A stage that writes warranty details (PPF, tint, final detail) needs them before its hand-over.
  const warrantyMissing = new Map<string, boolean>();
  for (const c of now) {
    const st = c.current;
    if (!st || !["ppf", "tint", "detail", "clean"].includes(st.key)) continue;
    const card = await warrantyCardOf(c.job.id, settings);
    warrantyMissing.set(c.job.id, !!card && stageAsks(st, c.stages.map((s) => s.key), card.rows).some((r) => rowMissing(r).length > 0));
  }
  const mayClockMe = mayPickPerson(scope, staff);
  const dueOf = (c: BoardCar, isComing: boolean) => (isComing ? c.stages.find((s) => s.section === section && s.status !== "done" && s.status !== "skipped")?.due_date : c.current?.due_date) ?? c.job.promised_at;
  const groupOf = (c: BoardCar, isComing: boolean): Group => {
    if (isComing) return "waiting";
    const due = dueOf(c, false);
    if (due && due < today) return "overdue";
    return clockedOn(c.job.id).some((id) => mine.some((p) => p.id === id)) ? "progress" : "ready";
  };
  const grouped: Record<Group, { car: BoardCar; coming: boolean }[]> = { overdue: [], ready: [], progress: [], waiting: [] };
  for (const c of now) grouped[groupOf(c, false)].push({ car: c, coming: false });
  for (const c of coming) grouped.waiting.push({ car: c, coming: true });
  const care = ((careRows ?? []) as unknown as { id: string; job_id: string; due_date: string | null; job: { job_number: string; gated_out_at: string | null; vehicle: Parameters<typeof formatPlate>[0] | null } | null }[]).filter((r) => !!r.job?.gated_out_at);

  const row = (c: BoardCar, isComing: boolean, group: Group) => {
    const v = c.job.vehicle;
    const stage = isComing ? c.stages.find((s) => s.section === section && s.status !== "done" && s.status !== "skipped") ?? c.current : c.current;
    const due = dueOf(c, isComing);
    const tone = due && due < today ? "red" : due === today ? "amber" : "normal";
    const onIds = c.people.map((p) => p.id);
    const clocked = clockedOn(c.job.id);
    const meOn = clocked.includes(staff.id);
    const next = stage ? c.stages.slice(c.stages.findIndex((s) => s.id === stage.id) + 1).find((s) => s.status !== "done" && s.status !== "skipped") : null;
    const problems = (probs ?? []).filter((p) => p.job_id === c.job.id);
    const openProblem = problems.find((p) => !p.answered_at);
    const lastAnswer = problems.find((p) => p.answered_at);
    return (
      <Card key={c.job.id} className={`flex flex-col gap-3 ${tone === "red" ? "border-red-bar" : tone === "amber" ? "border-amber-bar" : ""}`} data-mine-car={c.job.id} data-tone={tone} data-in-group={group}>
        <div className="flex flex-wrap items-center gap-3">
          {c.pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.pictureUrl} alt="" className="h-14 w-20 rounded-control object-cover bg-chip" />
          ) : <span className="h-14 w-20 rounded-control bg-chip" />}
          <div className="flex-1 min-w-0">
            <Link href={`/bodyshop/${c.job.id}`} className="text-lg font-extrabold tracking-[0.03em] hover:underline underline-offset-4">{v ? formatPlate(v) : c.job.job_number} <span className="text-sm font-semibold text-muted">· {[v?.make?.name, v?.model?.name].filter(Boolean).join(" ")}</span></Link>
            <div className="text-sm">{isComing ? <span className="text-muted">Coming: </span> : null}<span className="font-semibold">{stage?.label ?? "Waiting"}</span>{c.job.promised_at ? <span className="text-muted"> · handover {formatDate(c.job.promised_at)}</span> : null}</div>
          </div>
          <span className={`text-sm font-bold ${tone === "red" ? "text-red" : tone === "amber" ? "text-amber" : "text-muted"}`}>{due ? (tone === "red" ? `Late · ${formatDate(due)}` : tone === "amber" ? "Due today" : `Due ${formatDate(due)}`) : ""}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-mine-people>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">On it</span>
          <StaffPicker mode="chips" people={mine} sides={["bodyshop"]} on={onIds} action={assignAction.bind(null, c.job.id)} field="staff_id" fields={{ from: "mine" }} disabled={!canAct} />
          {c.people.filter((p) => !mine.some((m) => m.id === p.id)).map((p) => (
            <span key={p.id} className="inline-flex min-h-11 items-center gap-2 rounded-control border border-green bg-green-soft px-2.5 text-sm font-bold text-green" title="From another team">✓ {p.name}</span>
          ))}
        </div>
        {clocked.length ? <p className="text-xs text-muted" data-clocked-on>Clocked on: {clocked.map((id) => everyone.find((p) => p.id === id)?.display_name ?? "someone").join(", ")}</p> : null}
        {openProblem ? <p className="rounded-control bg-amber-soft px-3 py-2 text-sm font-semibold" data-mine-problem>Problem raised: {openProblem.text} · waiting for the manager</p> : lastAnswer ? <p className="rounded-control bg-green-soft px-3 py-2 text-sm" data-mine-answer><span className="font-semibold">Manager&apos;s answer:</span> {lastAnswer.answer}</p> : null}
        {canAct && c.job.is_open ? (
          <div className="flex flex-wrap items-center gap-2" data-mine-actions>
            {!isComing && mayClockMe ? (
              <form action={clockAction.bind(null, c.job.id)}>
                <input type="hidden" name="staff_id" value={staff.id} />
                <input type="hidden" name="from" value="mine" />
                {meOn ? <input type="hidden" name="out" value="1" /> : null}
                <Button type="submit" tone="secondary" size="md" data-clock-me={meOn ? "out" : "in"}>{meOn ? "Clock me off" : "Clock me on"}</Button>
              </form>
            ) : null}
            {!isComing && stage && stage.status === "active" && stage.section === section && warrantyMissing.get(c.job.id) ? (
              <LinkButton href={`/bodyshop/${c.job.id}#stages`} size="md" data-warranty-first>Warranty details first</LinkButton>
            ) : null}
            {!isComing && stage && stage.status === "active" && stage.section === section && !warrantyMissing.get(c.job.id) ? (
              <StageHandover jobId={c.job.id} stage={{ id: stage.id, key: stage.key, label: stage.label }} nextLabel={next ? `${next.label} – ${TEAM_OF_SECTION[next.section] ? TEAM_LABELS[TEAM_OF_SECTION[next.section]] : SECTION_LABELS[next.section]}` : null} photos={photosOf(stage.id)} needPin={role !== "owner"} action={handOverStageAction.bind(null, c.job.id, stage.id)} from="mine" />
            ) : null}
            <ProblemButton jobId={c.job.id} stageId={!isComing ? (stage?.id ?? null) : null} action={raiseProblemAction.bind(null, c.job.id)} from="mine" />
            {section === "ppf" || section === "detailing" ? <LinkButton href={`/bodyshop/${c.job.id}#materials`} tone="ghost" size="md">Materials</LinkButton> : null}
          </div>
        ) : null}
      </Card>
    );
  };
  return (
    <>
      <LiveRefresh tables={["jobs", "bodyshop_stages", "bodyshop_assignments", "bodyshop_clockings"]} alwaysPollMs={role === "team_leader" ? FALLBACK_POLL_MS : undefined} />
      <PageHeader
        title={`${TEAM_LABELS[team]} · my team`}
        subtitle={`${now.length} with you now · ${coming.length} coming · ${grouped.overdue.length} overdue`}
        actions={
          <>
            {role !== "team_leader" ? SECTIONS.map((s) => <LinkButton key={s} href={`/bodyshop/mine?section=${s}`} tone={s === section ? "primary" : "secondary"} size="md">{TEAM_LABELS[TEAM_OF_SECTION[s]]}</LinkButton>) : null}
            <LinkButton href="/bodyshop" tone="secondary" size="lg">Board</LinkButton>
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card className="flex flex-col gap-2" data-team-now>
        <SectionLabel right={`${mine.filter((p) => p.status === "working").length} clocked on · ${mine.filter((p) => p.status === "paused" && !p.onBreak).length} on a car, clocked off · ${mine.filter((p) => p.onBreak).length} on break · ${mine.filter((p) => p.status === "free" && !p.onBreak).length} free`}>My team now</SectionLabel>
        <StaffPicker mode="view" people={mine} sides={["bodyshop"]} showLoad={false} emptyText="Nobody in this team yet: the owner sets the teams on the Team page." />
      </Card>
      {care.length ? (
        <Card className="flex flex-col gap-2 border-ink" data-aftercare-due>
          <SectionLabel right={`${care.length}`}>10-day after-care checks</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {care.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="font-semibold">{r.job?.vehicle ? formatPlate(r.job.vehicle) : r.job?.job_number}</span>
                <span className={`text-xs ${r.due_date && r.due_date < today ? "font-bold text-red" : "text-muted"}`}>{r.due_date ? `due ${formatDate(r.due_date)}` : ""}</span>
                <LinkButton href={`/bodyshop/${r.job_id}#aftercare`} size="md" className="ml-auto">Do the check</LinkButton>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div className="flex flex-col gap-3">
        {GROUPS.flatMap((g) => [
          <div key={`h-${g.key}`} className="flex flex-col gap-1 pt-2" data-mine-group={g.key}>
            <SectionLabel right={`${grouped[g.key].length}`}>{g.title}</SectionLabel>
            {grouped[g.key].length === 0 ? <p className="text-sm text-muted">{g.empty}</p> : null}
          </div>,
          ...grouped[g.key].map((x) => row(x.car, x.coming, g.key)),
        ])}
      </div>
    </>
  );
}

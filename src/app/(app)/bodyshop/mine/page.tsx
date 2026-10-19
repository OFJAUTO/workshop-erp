import Link from "next/link";
import { redirect } from "next/navigation";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Avatar, Button, Card, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { SECTIONS, SECTION_LABELS, sectionOfDepartment, type Section } from "@/lib/bodyshop-kinds";
import { bodyshopPeople, loadBoard, sectionCars } from "@/lib/bodyshop";
import { formatDate } from "@/lib/format";
import { can, type RoleId } from "@/lib/roles";
import { formatPlate } from "@/lib/types";
import { assignAction, stageDoneAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * A team leader's screen: their section's cars in due order (car, stage, due date, who is on it), red late, amber
 * due today. One tap puts a person on a car, "Need help" pulls anyone from any team, and the stage is marked done here.
 */
export default async function MySectionPage({ searchParams }: { searchParams: Promise<{ section?: string; message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!can(role, "leadSection") || !can(role, "viewBodyshop")) redirect("/home");
  const { section: q, message, error } = await searchParams;
  const own = sectionOfDepartment(staff.department_id);
  const section = ((role === "team_leader" ? own : (q as Section | undefined) ?? own) ?? "ppf") as Section;
  if (!SECTIONS.includes(section)) redirect("/bodyshop");
  const [board, people] = await Promise.all([loadBoard(), bodyshopPeople()]);
  const { now, coming } = sectionCars(board.cars, section);
  const mine = people.staff.filter((p) => p.section === section && p.role_id === "technician");
  const others = people.staff.filter((p) => p.section !== section && p.role_id === "technician");
  const canAct = !staff.viewingAs;
  const row = (c: (typeof now)[number], isComing: boolean) => {
    const v = c.job.vehicle;
    const stage = isComing ? c.stages.find((s) => s.section === section && s.status !== "done" && s.status !== "skipped") ?? c.current : c.current;
    const due = stage?.due_date ?? c.job.promised_at;
    const tone = due && due < board.today ? "red" : due === board.today ? "amber" : "normal";
    const onIds = new Set(c.people.map((p) => p.id));
    return (
      <Card key={c.job.id} className={`flex flex-col gap-3 ${tone === "red" ? "border-red-bar" : tone === "amber" ? "border-amber-bar" : ""}`} data-mine-car={c.job.id} data-tone={tone}>
        <div className="flex flex-wrap items-center gap-3">
          {c.pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.pictureUrl} alt="" className="h-14 w-20 rounded-control object-cover bg-chip" />
          ) : <span className="h-14 w-20 rounded-control bg-chip" />}
          <div className="flex-1 min-w-0">
            <Link href={`/bodyshop/${c.job.id}`} className="text-lg font-extrabold tracking-[0.03em] hover:underline underline-offset-4">{v ? formatPlate(v) : c.job.job_number} <span className="text-sm font-semibold text-muted">· {[v?.make?.name, v?.model?.name].filter(Boolean).join(" ")}{v?.colour ? ` · ${v.colour}` : ""}</span></Link>
            <div className="text-sm">{isComing ? <span className="text-muted">Coming: </span> : null}<span className="font-semibold">{stage?.label ?? "Waiting"}</span>{c.job.promised_at ? <span className="text-muted"> · handover {formatDate(c.job.promised_at)}</span> : null}</div>
          </div>
          <span className={`text-sm font-bold ${tone === "red" ? "text-red" : tone === "amber" ? "text-amber" : "text-muted"}`}>{due ? (tone === "red" ? `Late · ${formatDate(due)}` : tone === "amber" ? "Due today" : `Due ${formatDate(due)}`) : ""}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2" data-mine-people>
          <span className="text-xs font-bold uppercase tracking-[0.08em] text-muted">On it</span>
          {mine.map((p) => (
            <form key={p.id} action={assignAction.bind(null, c.job.id)}>
              <input type="hidden" name="staff_id" value={p.id} />
              <input type="hidden" name="from" value="mine" />
              {onIds.has(p.id) ? <input type="hidden" name="off" value="1" /> : null}
              <button type="submit" disabled={!canAct} className={`inline-flex min-h-10 items-center gap-2 rounded-control border px-2.5 text-sm font-bold ${onIds.has(p.id) ? "border-green bg-green-soft text-green" : "border-line-strong bg-white"}`} aria-pressed={onIds.has(p.id)} data-assign-person={p.id}>
                <Avatar name={p.name} photoUrl={p.photoUrl} size={24} />{onIds.has(p.id) ? "✓ " : ""}{p.name}
              </button>
            </form>
          ))}
          {c.people.filter((p) => !mine.some((m) => m.id === p.id)).map((p) => (
            <form key={p.id} action={assignAction.bind(null, c.job.id)}>
              <input type="hidden" name="staff_id" value={p.id} />
              <input type="hidden" name="from" value="mine" />
              <input type="hidden" name="off" value="1" />
              <button type="submit" disabled={!canAct} className="inline-flex min-h-10 items-center gap-2 rounded-control border border-green bg-green-soft px-2.5 text-sm font-bold text-green" title="From another team">✓ {p.name}</button>
            </form>
          ))}
          <details className="relative">
            <summary className="list-none cursor-pointer inline-flex min-h-10 items-center rounded-control border border-dashed border-line-strong px-3 text-sm font-bold">Need help</summary>
            <div className="absolute left-0 z-20 mt-1 w-72 rounded-card border border-line bg-white p-2 shadow-xl flex flex-wrap gap-1.5">
              {others.length === 0 ? <span className="text-xs text-muted">Nobody in the other teams.</span> : null}
              {others.map((p) => (
                <form key={p.id} action={assignAction.bind(null, c.job.id)}>
                  <input type="hidden" name="staff_id" value={p.id} />
                  <input type="hidden" name="from" value="mine" />
                  <button type="submit" disabled={!canAct || onIds.has(p.id)} className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-line-strong bg-white px-2 text-xs font-bold disabled:opacity-50"><Avatar name={p.name} photoUrl={p.photoUrl} size={20} />{p.name}</button>
                </form>
              ))}
            </div>
          </details>
          {!isComing && stage && stage.status === "active" && canAct ? (
            <form action={stageDoneAction.bind(null, c.job.id, stage.id)} className="ml-auto">
              <Button type="submit" size="md" data-stage-done>{stage.label} done</Button>
            </form>
          ) : null}
        </div>
      </Card>
    );
  };
  return (
    <>
      <LiveRefresh tables={["jobs", "bodyshop_stages", "bodyshop_assignments"]} />
      <PageHeader
        title={`${SECTION_LABELS[section]} · my cars`}
        subtitle={`${now.length} with you now · ${coming.length} coming`}
        actions={
          <>
            {role !== "team_leader" ? SECTIONS.map((s) => <LinkButton key={s} href={`/bodyshop/mine?section=${s}`} tone={s === section ? "primary" : "secondary"} size="md">{SECTION_LABELS[s]}</LinkButton>) : null}
            <LinkButton href="/bodyshop" tone="secondary" size="lg">Board</LinkButton>
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <section className="flex flex-col gap-3">
        <SectionLabel right={`${now.length}`}>With {SECTION_LABELS[section]} now, due order</SectionLabel>
        {now.length === 0 ? <p className="text-sm text-muted">No cars with your section right now.</p> : now.map((c) => row(c, false))}
      </section>
      <section className="flex flex-col gap-3">
        <SectionLabel right={`${coming.length}`}>Coming to you</SectionLabel>
        {coming.length === 0 ? <p className="text-sm text-muted">Nothing on its way.</p> : coming.map((c) => row(c, true))}
      </section>
    </>
  );
}

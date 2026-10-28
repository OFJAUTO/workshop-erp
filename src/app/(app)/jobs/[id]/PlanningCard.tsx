import { Avatar, Button, Card, Input, LinkButton, SectionLabel } from "@/components/ui";
import { CopyText } from "@/components/CopyText";
import { StaffPicker } from "@/components/StaffPicker";
import { positionsWords } from "@/lib/parts-list";
import { formatDate } from "@/lib/format";
import { formatWait, workingMinutesSince, type JobStatus } from "@/lib/jobs";
import { SIDE_LABEL, SIDE_MANAGER, sideReleased, type Side } from "@/lib/job-sides";
import type { Planning } from "@/lib/planning";
import type { RoleId } from "@/lib/roles";
import type { TechnicianLoad } from "@/lib/technician-load";
import type { JobRow } from "@/lib/types";
import type { WorkingTime } from "@/lib/working-time";
import { confirmPromisedDate, releaseToBodyshop, releaseToWorkshop, remindPlanning } from "../planning-actions";

const RING = { grey: "ring-line bg-chip", amber: "ring-amber-bar bg-amber-soft", green: "ring-green bg-green-soft" } as const;
const REMIND: Record<string, string> = { parts: "Parts", workshop: "the workshop manager", bodyshop: "the bodyshop manager", both_sides: "both managers", advisor: "the advisor" };

/**
 * The Planning card inside the Parts step: one circle per person with their face (grey not their turn, amber waiting
 * on them, green done) - Parts, then the manager of each side the car needs (Workshop, Bodyshop, or both on a mixed
 * car, released separately), then the advisor - and the form for whoever's turn it is. The owner can fill any circle.
 */
export function PlanningCard({ jobId, job, status, plan, role, mySide, viewingAs, wt, people, customer, carText, advisorName, whatsapp }: { jobId: string; job: Pick<JobRow, "plan_released_at" | "plan_bodyshop_released_at">; status: JobStatus; plan: Planning; role: RoleId; mySide: Side | null; viewingAs: boolean; wt: WorkingTime; people: TechnicianLoad[]; customer: { name: string; phoneDigits: string } | null; carText: string; advisorName: string; whatsapp: boolean }) {
  const owner = role === "owner";
  const canParts = !viewingAs && (owner || role === "parts");
  const canRelease = (side: Side) => !viewingAs && (owner || (role === "workshop_manager" && (!mySide || mySide === side)));
  const canAdvisor = !viewingAs && (owner || role === "service_advisor");
  const turn = plan.waitingOn;
  const otherWent = (side: Side) => plan.sides.some((s) => s !== side && sideReleased(job, s));
  const releasable = (side: Side) => plan.releaseNow.includes(side) && (["approved", "waiting_parts"].includes(status) || (status === "in_work" && otherWent(side)));
  const advisorCircle = plan.circles.find((c) => c.key === "advisor")!;
  const promisedText = advisorCircle.state === "green" ? advisorCircle.line.replace("Promised ", "") : null;
  const waMessage = promisedText && customer ? `Dear ${customer.name}, your ${carText} is planned to be ready on ${formatDate(promisedText + "T12:00:00+04:00")}. Thank you, ${advisorName}, OFJ Automotive` : null;
  return (
    <Card className={`flex flex-col gap-4 ${turn ? "border-ink" : ""}`} id="planning" data-planning-sides={plan.sides.join(",")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Planning</SectionLabel>
        {turn && !viewingAs ? (
          <form action={remindPlanning.bind(null, jobId)}>
            <Button type="submit" tone="secondary" size="md">Remind {REMIND[turn]}</Button>
          </form>
        ) : null}
      </div>
      <ol className={`grid gap-3 ${plan.circles.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
        {plan.circles.map((c) => (
          <li key={c.key} className="flex flex-col items-center gap-1.5 text-center" data-circle={c.key} data-state={c.state}>
            <span className={`relative inline-flex h-16 w-16 items-center justify-center rounded-full ring-4 ${RING[c.state]}`}>
              <Avatar name={c.person?.name ?? c.title} photoUrl={c.person?.photoUrl ?? null} size={56} />
              <span className="absolute -top-1 -left-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-ink text-white text-xs font-extrabold">{c.n}</span>
            </span>
            <span className="text-sm font-bold">{c.title}</span>
            <span className="text-xs text-muted">{c.person?.name ?? ""}</span>
            <span className={`text-xs ${c.state === "amber" ? "font-semibold text-amber" : c.state === "green" ? "text-green font-semibold" : "text-muted"}`}>
              {c.state === "amber" && c.since ? `Waiting ${formatWait(workingMinutesSince(c.since, wt), wt)} · ` : ""}{c.line}
            </span>
          </li>
        ))}
      </ol>

      {turn === "parts" && canParts && ["approved", "waiting_parts"].includes(status) ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <LinkButton href={`/parts/${jobId}#lpo`} size="md">Open Parts: the LPO</LinkButton>
          <span className="text-xs text-muted">{plan.circles[0].line}</span>
        </div>
      ) : null}

      {plan.sides.filter(releasable).map((side) =>
        canRelease(side) ? (
          <form key={side} action={(side === "bodyshop" ? releaseToBodyshop : releaseToWorkshop).bind(null, jobId)} className="flex flex-col gap-3 border-t border-line pt-3" data-release-form={side}>
            {plan.sides.length > 1 ? <span className="text-sm font-extrabold">{SIDE_LABEL[side]} side</span> : null}
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Start day</span><Input type="date" name="start_date" defaultValue={plan.partsReadyDate ?? ""} required className="w-44" /></label>
              <span className="text-xs text-muted">{plan.missing.length ? `Parts all here by ${plan.partsReadyDate ?? "a date Parts still have to give"}.` : plan.parts.length ? "Every part is here." : "No parts needed."} {side === "bodyshop" ? "Bodyshop stages" : "Hours estimate"} {plan.hoursBySide[side] ? `${plan.hoursBySide[side]} h` : "not set"}.</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">{side === "bodyshop" ? "Bodyshop team (tick one or more; the leaders are at the top of each team)" : "Technicians (tick one or more)"}</span>
              <StaffPicker mode="tick" people={people.filter((p) => p.side === side)} sides={[side]} />
            </div>
            {plan.missing.length ? (
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="force" className="mt-1 h-5 w-5 accent-ink" />
                <span><span className="font-semibold">Start with available parts.</span> Missing: {plan.missing.map((p) => `${p.description}${positionsWords(p.positions) ? ` · ${positionsWords(p.positions)}` : ""}${p.expected_date ?? p.delivery_date ? ` (${p.expected_date ?? p.delivery_date})` : ""}`).join(", ")}.</span>
              </label>
            ) : null}
            <div><Button type="submit" size="lg" data-release={side}>{side === "bodyshop" ? "Release to bodyshop" : "Release to workshop"}</Button></div>
            {side === "bodyshop" ? <p className="text-xs text-muted">The car enters the bodyshop stages from the approved packages, with due dates spread from the start day to the handover. The first team is told.</p> : null}
          </form>
        ) : (
          <p key={side} className="text-xs text-muted" data-release-waiting={side}>Waiting for {SIDE_MANAGER[side]} to pick the start day and {side === "bodyshop" ? "the bodyshop team" : "the technicians"}.</p>
        ),
      )}

      {turn === "advisor" && canAdvisor ? (
        <form action={confirmPromisedDate.bind(null, jobId)} className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Finish date (suggested from the start day and the hours)</span><Input type="date" name="promised_at" defaultValue={plan.suggestedFinish ?? ""} required className="w-44" /></label>
          <Button type="submit" size="lg">Confirm the date</Button>
          <span className="w-full text-xs text-muted">This is the promised date on the dashboard. The work has already started; this never holds it up.</span>
        </form>
      ) : null}
      {promisedText && whatsapp && customer?.phoneDigits && waMessage ? (
        <div className="flex flex-wrap gap-2">
          <a href={`https://wa.me/${customer.phoneDigits}?text=${encodeURIComponent(waMessage)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control border border-ink bg-white px-4 text-sm font-bold">Tell the customer on WhatsApp</a>
          <CopyText text={waMessage} />
        </div>
      ) : null}
      {plan.technicians.length ? <p className="text-xs text-muted">On the car: {plan.technicians.map((t) => `${t.display_name}${t.left_at ? " (left)" : t.done_at ? " (done)" : ""}`).join(", ")}</p> : null}
    </Card>
  );
}

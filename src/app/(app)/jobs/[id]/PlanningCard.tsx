import { Avatar, Button, Card, Input, LinkButton, SectionLabel } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { formatWait, workingMinutesSince, type JobStatus } from "@/lib/jobs";
import type { Planning } from "@/lib/planning";
import type { RoleId } from "@/lib/roles";
import type { WorkingTime } from "@/lib/working-time";
import { allInStock, confirmPromisedDate, partsPlanned, releaseToWorkshop, remindPlanning } from "../planning-actions";

const RING = { grey: "ring-line bg-chip", amber: "ring-amber-bar bg-amber-soft", green: "ring-green bg-green-soft" } as const;

/**
 * The Planning card inside the Parts step: three circles with each person's face (grey not their turn,
 * amber waiting on them, green done), and the form for whoever's turn it is. The owner can fill any circle.
 */
export function PlanningCard({ jobId, status, plan, role, viewingAs, wt, technicians, customer, carText, advisorName, whatsapp }: { jobId: string; status: JobStatus; plan: Planning; role: RoleId; viewingAs: boolean; wt: WorkingTime; technicians: { id: string; display_name: string }[]; customer: { name: string; phoneDigits: string } | null; carText: string; advisorName: string; whatsapp: boolean }) {
  const owner = role === "owner";
  const canParts = !viewingAs && (owner || role === "parts");
  const canWorkshop = !viewingAs && (owner || role === "workshop_manager");
  const canAdvisor = !viewingAs && (owner || role === "service_advisor");
  const turn = plan.waitingOn;
  const inPlanning = ["approved", "waiting_parts"].includes(status);
  const promisedText = plan.circles[2].state === "green" ? plan.circles[2].line.replace("Promised ", "") : null;
  const waMessage = promisedText && customer ? `Dear ${customer.name}, your ${carText} is planned to be ready on ${formatDate(promisedText + "T12:00:00+04:00")}. Thank you, ${advisorName}, OFJ Automotive` : null;
  return (
    <Card className={`flex flex-col gap-4 ${turn ? "border-ink" : ""}`} id="planning">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>Planning</SectionLabel>
        {turn && !viewingAs ? (
          <form action={remindPlanning.bind(null, jobId)}>
            <Button type="submit" tone="secondary" size="md">Remind {turn === "parts" ? "Parts" : turn === "workshop" ? "the workshop manager" : "the advisor"}</Button>
          </form>
        ) : null}
      </div>
      <ol className="grid grid-cols-3 gap-3">
        {plan.circles.map((c) => (
          <li key={c.key} className="flex flex-col items-center gap-1.5 text-center">
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

      {turn === "parts" && canParts && inPlanning ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <LinkButton href={`/parts/${jobId}`} size="md">Plan the parts: in stock or to order</LinkButton>
          {plan.unplanned.length ? (
            <form action={allInStock.bind(null, jobId)}><Button type="submit" tone="secondary" size="md">All in stock</Button></form>
          ) : (
            <form action={partsPlanned.bind(null, jobId)}><Button type="submit" tone="secondary" size="md">Parts planned</Button></form>
          )}
          {plan.unplanned.length ? <span className="text-xs text-muted">{plan.unplanned.length} part{plan.unplanned.length === 1 ? "" : "s"} still to decide.</span> : null}
        </div>
      ) : null}

      {turn === "workshop" && canWorkshop && inPlanning ? (
        <form action={releaseToWorkshop.bind(null, jobId)} className="flex flex-col gap-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Start day</span><Input type="date" name="start_date" defaultValue={plan.partsReadyDate ?? ""} required className="w-44" /></label>
            <span className="text-xs text-muted">{plan.missing.length ? `Parts all here by ${plan.partsReadyDate ?? "a date Parts still have to give"}.` : "Every part is here."} Hours estimate {plan.hoursEstimate ? `${plan.hoursEstimate} h` : "not set"}.</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-muted">Technicians (tick one or more)</span>
            <div className="flex flex-wrap gap-2">
              {technicians.map((t) => (
                <label key={t.id} className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong bg-white px-3 text-sm font-semibold cursor-pointer has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white">
                  <input type="checkbox" name="technician" value={t.id} className="sr-only" />{t.display_name}
                </label>
              ))}
            </div>
          </div>
          {plan.missing.length ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="force" className="mt-1 h-5 w-5 accent-ink" />
              <span><span className="font-semibold">Start with available parts.</span> Missing: {plan.missing.map((p) => `${p.description}${p.expected_date ?? p.delivery_date ? ` (${p.expected_date ?? p.delivery_date})` : ""}`).join(", ")}.</span>
            </label>
          ) : null}
          <div><Button type="submit" size="lg">Release to workshop</Button></div>
        </form>
      ) : null}
      {turn === "workshop" && !canWorkshop && inPlanning ? <p className="text-xs text-muted">Waiting for the workshop manager to pick the start day and the technicians.</p> : null}

      {turn === "advisor" && canAdvisor ? (
        <form action={confirmPromisedDate.bind(null, jobId)} className="flex flex-wrap items-end gap-3 border-t border-line pt-3">
          <label className="flex flex-col gap-1"><span className="text-xs font-semibold text-muted">Finish date (suggested from the start day and the hours)</span><Input type="date" name="promised_at" defaultValue={plan.suggestedFinish ?? ""} required className="w-44" /></label>
          <Button type="submit" size="lg">Confirm the date</Button>
          <span className="w-full text-xs text-muted">This is the promised date on the dashboard. The work has already started; this never holds it up.</span>
        </form>
      ) : null}
      {promisedText && whatsapp && customer?.phoneDigits && waMessage ? (
        <a href={`https://wa.me/${customer.phoneDigits}?text=${encodeURIComponent(waMessage)}`} target="_blank" rel="noreferrer" className="self-start inline-flex min-h-11 items-center rounded-control border border-ink bg-white px-4 text-sm font-bold">Tell the customer on WhatsApp</a>
      ) : null}
      {plan.technicians.length ? <p className="text-xs text-muted">On the car: {plan.technicians.map((t) => `${t.display_name}${t.left_at ? " (left)" : t.done_at ? " (done)" : ""}`).join(", ")}</p> : null}
    </Card>
  );
}

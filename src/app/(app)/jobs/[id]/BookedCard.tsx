import { Badge, Card, LinkButton, SectionLabel } from "@/components/ui";
import { StartLooseJob } from "@/components/StartLooseJob";
import { bookedView } from "@/lib/loose-start";
import { arrivalDueWords, bookedPartWords, handoverRiskWords } from "@/lib/booked-job-rules";
import { formatDateTime } from "@/lib/format";

/**
 * A booked car before it arrives (20 November 2026, Section 2): the jobs, the parts and their status, the booking time
 * and the promised handover; red "ARRIVAL WAS DUE …" once the time has passed, a warning when parts arrive after the
 * promised handover, and the two ways forward (gate the car in, or start the job as loose items when no car comes).
 */
export async function BookedCard({ jobId, vehicleId, isBodyshop, canStart, canGateIn }: { jobId: string; vehicleId: string; isBodyshop: boolean; canStart: boolean; canGateIn: boolean }) {
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const v = await bookedView(jobId);
  if (!v) return null;
  const due = arrivalDueWords(v.arrivalAt, nowMs);
  const risk = handoverRiskWords(v.partsLate, v.promisedAt);
  return (
    <Card className={`flex flex-col gap-3 ${due ? "!border-red" : ""}`} data-booked-card>
      <SectionLabel right={<Badge tone="amber">Booked, not arrived</Badge>}>Before the car arrives</SectionLabel>
      {due ? <p className="rounded-control bg-red-soft px-3 py-2 text-sm font-extrabold text-red" data-arrival-due>{due}</p> : null}
      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <span className="flex flex-col"><span className="text-xs font-semibold uppercase text-muted">Booked arrival</span><span className="font-bold" data-booked-arrival>{v.arrivalAt ? formatDateTime(v.arrivalAt) : "Not booked"}</span></span>
        <span className="flex flex-col"><span className="text-xs font-semibold uppercase text-muted">Promised handover</span><span className="font-bold" data-booked-promised>{v.promisedAt ? formatDateTime(v.promisedAt) : "Not set"}</span></span>
      </div>
      {v.estimateNumber ? <p className="text-sm" data-booked-estimate>Estimate {v.estimateNumber}{v.estimateStatus === "approved" ? " · approved by the customer" : ` · ${v.estimateStatus ?? ""}`}</p> : null}
      {v.lines.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-muted">The jobs</span>
          <ul className="flex flex-col gap-0.5 text-sm" data-booked-lines>{v.lines.map((l, i) => <li key={i}>{l.title}</li>)}</ul>
        </div>
      ) : null}
      {v.parts.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-muted">Parts</span>
          <ul className="divide-y divide-line text-sm" data-booked-parts>
            {v.parts.map((p, i) => <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-1"><span>{p.name.toUpperCase()}</span><span className="text-muted" data-booked-part-state>{bookedPartWords(p)}</span></li>)}
          </ul>
        </div>
      ) : null}
      {risk ? <p className="rounded-control bg-amber-soft px-3 py-2 text-sm font-semibold" data-handover-risk>{risk}</p> : null}
      <div className="flex flex-wrap items-start gap-3">
        {canGateIn ? <LinkButton href={`/gate-in/new?vehicle=${vehicleId}`} size="lg" tone="secondary" data-booked-gate-in>Gate in the car</LinkButton> : null}
        {isBodyshop ? <LinkButton href={`/bodyshop/${jobId}`} size="lg" tone="secondary">Bodyshop booking</LinkButton> : null}
        {canStart && v.estimateId && v.estimateStatus === "approved" ? <StartLooseJob estimateId={v.estimateId} estimateNumber={v.estimateNumber ?? "the estimate"} back={`/jobs/${jobId}`} /> : null}
      </div>
    </Card>
  );
}

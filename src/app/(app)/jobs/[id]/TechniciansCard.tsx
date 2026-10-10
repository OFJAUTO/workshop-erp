import { Badge, Button, Card, SectionLabel } from "@/components/ui";
import type { JobTechnician } from "@/lib/job-technicians";
import { addTechnicianToJob, makeLeadTechnician, removeTechnicianFromJob } from "../planning-actions";

/**
 * Who is on the car, for the workshop manager: add a technician with one tap, take one off, or make
 * another one the lead (the lead does the inspection and is the name on the job). Available from
 * the first assignment until the manager confirms the work is finished; after that it only lists.
 */
export function TechniciansCard({ jobId, technicians, available, canEdit, canChangeLead, from = "job" }: { jobId: string; technicians: JobTechnician[]; available: { id: string; display_name: string }[]; canEdit: boolean; canChangeLead: boolean; from?: "job" | "work" }) {
  const others = available.filter((t) => !technicians.some((x) => x.staff_id === t.id));
  return (
    <Card className="flex flex-col gap-3" id="technicians">
      <SectionLabel right={`${technicians.length}`}>Technicians on the car</SectionLabel>
      {technicians.length === 0 ? <p className="text-sm text-muted">Nobody yet.</p> : null}
      <ul className="divide-y divide-line text-sm">
        {technicians.map((t) => (
          <li key={t.staff_id} className="py-2 flex flex-wrap items-center gap-2">
            <span className="font-semibold">{t.display_name}</span>
            {t.lead ? <Badge tone="ink">Lead</Badge> : null}
            {t.working ? <Badge tone="green">Working</Badge> : t.done_at ? <Badge tone="outline">Done</Badge> : null}
            {canEdit ? (
              <span className="ml-auto flex flex-wrap gap-2">
                {!t.lead && canChangeLead ? (
                  <form action={makeLeadTechnician.bind(null, jobId, t.staff_id)}>
                    <input type="hidden" name="from" value={from} />
                    <Button type="submit" tone="ghost" size="md">Make lead</Button>
                  </form>
                ) : null}
                <form action={removeTechnicianFromJob.bind(null, jobId, t.staff_id)}>
                  <input type="hidden" name="from" value={from} />
                  <Button type="submit" tone="ghost" size="md" className="text-red">Take off</Button>
                </form>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit && others.length ? (
        <div className="flex flex-col gap-1 border-t border-line pt-3">
          <span className="text-xs font-semibold text-muted">Add a technician (one tap)</span>
          <div className="flex flex-wrap gap-2">
            {others.map((t) => (
              <form key={t.id} action={addTechnicianToJob.bind(null, jobId)}>
                <input type="hidden" name="from" value={from} />
                <input type="hidden" name="technician" value={t.id} />
                <Button type="submit" tone="secondary" size="md">+ {t.display_name}</Button>
              </form>
            ))}
          </div>
        </div>
      ) : null}
      {canEdit ? <p className="text-xs text-muted">The lead does the inspection and carries the job. Any technician can be added or taken off until you confirm the work is finished.</p> : null}
    </Card>
  );
}

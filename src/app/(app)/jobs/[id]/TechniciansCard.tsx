import Link from "next/link";
import { Badge, Button, Card, SectionLabel } from "@/components/ui";
import { StaffPicker } from "@/components/StaffPicker";
import type { JobTechnician } from "@/lib/job-technicians";
import { TEAM_LABELS, TEAM_OF_SECTION, type Side } from "@/lib/teams";
import type { TechnicianLoad } from "@/lib/technician-load";
import { addTechnicianToJob, makeLeadTechnician, removeBodyshopPersonFromJob, removeTechnicianFromJob } from "../planning-actions";

export type BodyshopOnCar = { staff_id: string; display_name: string; section: string; leader: boolean };

/**
 * Who is on the car, for the managers: the mechanical technicians (lead, working, done; Make lead, Take off), the
 * bodyshop team by section, and the shared staff picker to add someone with one tap - grouped by team, leaders first,
 * the car's sides only. Editable from the first assignment until the work is confirmed finished.
 */
export function TechniciansCard({ jobId, technicians: allTechnicians, bodyshop = [], people, sides: carSides, mySide = null, canEdit, canChangeLead, from = "job" }: { jobId: string; technicians: JobTechnician[]; bodyshop?: BodyshopOnCar[]; people: TechnicianLoad[]; sides: Side[]; mySide?: Side | null; canEdit: boolean; canChangeLead: boolean; from?: "job" | "work" }) {
  // A bodyshop person who carries the job (assigned_to) is listed once, under the bodyshop.
  const technicians = allTechnicians.filter((t) => !bodyshop.some((b) => b.staff_id === t.staff_id));
  const onCar = [...technicians.map((t) => t.staff_id), ...bodyshop.map((b) => b.staff_id)];
  // A side's manager works on their own side's people; the owner on both.
  const sides = mySide ? carSides.filter((s) => s === mySide) : carSides;
  const editMech = canEdit && (!mySide || mySide === "mechanical");
  const editBody = canEdit && (!mySide || mySide === "bodyshop");
  return (
    <Card className="flex flex-col gap-3" id="technicians" data-on-car>
      <SectionLabel right={`${onCar.length}`}>On the car</SectionLabel>
      {onCar.length === 0 ? <p className="text-sm text-muted">Nobody yet.</p> : null}
      {technicians.length ? (
        <ul className="divide-y divide-line text-sm">
          {technicians.map((t) => (
            <li key={t.staff_id} className="py-2 flex flex-wrap items-center gap-2" data-on-car-person={t.staff_id}>
              <span className="font-semibold">{t.display_name}</span>
              {t.lead ? <Badge tone="ink">Lead</Badge> : null}
              {t.working ? <Badge tone="green">Working</Badge> : t.done_at ? <Badge tone="outline">Done</Badge> : null}
              {editMech ? (
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
      ) : null}
      {bodyshop.length ? (
        <div className="flex flex-col gap-1" data-on-car-bodyshop>
          <span className="text-xs font-semibold text-muted">Bodyshop · <Link href={`/bodyshop/${jobId}`} className="underline underline-offset-4">stages and clocking</Link></span>
          <ul className="divide-y divide-line text-sm">
            {bodyshop.map((b) => (
              <li key={b.staff_id} className="py-2 flex flex-wrap items-center gap-2" data-on-car-person={b.staff_id}>
                <span className="font-semibold">{b.display_name}</span>
                {b.leader ? <Badge tone="ink">Leader</Badge> : null}
                <span className="text-xs text-muted">{TEAM_LABELS[TEAM_OF_SECTION[b.section] ?? "dismantle_refit"]}</span>
                {editBody ? (
                  <form action={removeBodyshopPersonFromJob.bind(null, jobId, b.staff_id)} className="ml-auto">
                    <input type="hidden" name="from" value={from} />
                    <Button type="submit" tone="ghost" size="md" className="text-red">Take off</Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {canEdit && sides.length ? (
        <details className="border-t border-line pt-3" data-add-person>
          <summary className="cursor-pointer min-h-11 flex items-center text-sm font-semibold underline underline-offset-4">Add someone (one tap)</summary>
          <div className="pt-2">
            <StaffPicker mode="tap" people={people.filter((p) => sides.includes(p.side))} sides={sides} exclude={onCar} action={addTechnicianToJob.bind(null, jobId)} fields={{ from }} />
          </div>
        </details>
      ) : null}
      {canEdit ? <p className="text-xs text-muted">The lead does the inspection and carries the job. People can be added or taken off until you confirm the work is finished.</p> : null}
    </Card>
  );
}

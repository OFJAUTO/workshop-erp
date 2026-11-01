"use client";

import { useRef } from "react";
import { Card, SectionLabel } from "@/components/ui";
import { LINE_TEAMS, LINE_TEAM_LABELS, type LineTeam } from "@/lib/line-teams";

type Action = (formData: FormData) => void | Promise<void>;
export type TeamLineRow = { id: string; title: string; team: LineTeam; chosen: boolean; onTeam: Action };
export type MisfitRow = { name: string; why: string };

const DEPARTMENTS = [
  { value: "mechanical", label: "Mechanical" },
  { value: "bodyshop", label: "Bodyshop" },
  { value: "both", label: "Both" },
];

/** One line's team: a small dropdown that saves as soon as a team is picked. */
function TeamSelect({ row, disabled }: { row: TeamLineRow; disabled: boolean }) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={row.onTeam} className="shrink-0">
      <label className="sr-only" htmlFor={`team-${row.id}`}>Team for {row.title}</label>
      <select id={`team-${row.id}`} name="team" defaultValue={row.team} disabled={disabled} onChange={() => form.current?.requestSubmit()} className="h-11 rounded-control border border-line-strong bg-white px-2 text-sm font-semibold" data-line-team={row.id}>
        {LINE_TEAMS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
    </form>
  );
}

/**
 * The car's department and the team on each line of its work (1 November 2026, J-00969). Department: Mechanical /
 * Bodyshop / Both, one tap. Each line: Mechanical · Electrical · Dismantle & refit · Paint · PPF · Detailing & cleaning ·
 * Outside work. People already on the car who no longer fit are listed for reassigning (never dropped by themselves).
 */
export function TeamsCard({ department, canChange, onDepartment, lines, linesReady, misfits, workWords, withCar }: { /** The team that has the car right now ("Paint"). */ withCar?: string | null; department: string; canChange: boolean; onDepartment: Action; lines: TeamLineRow[]; linesReady: boolean; misfits: MisfitRow[]; workWords: string }) {
  return (
    <Card id="teams" className="flex flex-col gap-3" data-teams-card data-department={department}>
      <div className="flex flex-wrap items-center gap-2">
        <SectionLabel right={workWords || undefined}>Department and teams</SectionLabel>
        {withCar ? <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-bold text-white" data-team-with-car>With {withCar} now</span> : null}
      </div>
      <form action={onDepartment} className="flex flex-wrap items-center gap-2" data-department-form>
        <span className="text-sm font-semibold">Department</span>
        {DEPARTMENTS.map((d) => (
          <button key={d.value} type="submit" name="department" value={d.value} disabled={!canChange || d.value === department} aria-pressed={d.value === department} className={`min-h-11 rounded-control border px-4 text-sm font-bold ${d.value === department ? "border-ink bg-ink text-white" : "border-line-strong bg-white"} disabled:cursor-default`} data-department-choice={d.value}>
            {d.label}
          </button>
        ))}
      </form>
      {lines.length ? (
        <ul className="divide-y divide-line" data-team-lines>
          {lines.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-2 py-2" data-team-line={l.id} data-team={l.team}>
              <span className="min-w-0 flex-1 text-sm font-semibold uppercase">{l.title}</span>
              {!l.chosen ? <span className="text-[11px] text-muted">default</span> : null}
              {canChange && linesReady ? <TeamSelect row={l} disabled={false} /> : <span className="rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-bold">{LINE_TEAM_LABELS[l.team]}</span>}
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted">The teams follow the approved work.</p>}
      {canChange && !linesReady && lines.length ? <p className="text-xs text-muted">Choosing a team per line switches on with the database update (waiting for apply); until then each line shows its default team.</p> : null}
      {misfits.length ? (
        <div className="rounded-control border border-amber-bar bg-amber-soft/40 p-3 flex flex-col gap-1" data-team-misfits>
          <span className="text-sm font-extrabold">Needs reassigning ({misfits.length})</span>
          {misfits.map((m) => <span key={m.name} className="text-sm" data-team-misfit>{m.name}: {m.why}</span>)}
          <span className="text-xs text-muted">They stay on the car until a manager takes them off (Technicians card) or moves them to the right lines.</span>
        </div>
      ) : null}
    </Card>
  );
}

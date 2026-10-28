/** Teams inside each side (section 6, 21 October 2026). Pure: no imports. */

export type Side = "mechanical" | "bodyshop";
export type TeamKey = "technicians" | "electricians" | "helpers" | "dismantle_refit" | "ppf" | "painting" | "detailing_cleaning";

export const TEAMS: Record<Side, { key: TeamKey; label: string }[]> = {
  mechanical: [
    { key: "technicians", label: "Technicians" },
    { key: "electricians", label: "Electricians" },
    { key: "helpers", label: "Helpers" },
  ],
  bodyshop: [
    { key: "dismantle_refit", label: "Dismantle & refit" },
    { key: "ppf", label: "PPF" },
    { key: "painting", label: "Painting" },
    { key: "detailing_cleaning", label: "Detailing & cleaning" },
  ],
};

export const TEAM_LABELS: Record<TeamKey, string> = Object.fromEntries(Object.values(TEAMS).flat().map((t) => [t.key, t.label])) as Record<TeamKey, string>;

/** A person's team, with a sensible fallback from their department side. */
export function teamOf(p: { team?: string | null; department_id?: string | null }): TeamKey {
  const t = p.team as TeamKey | null | undefined;
  if (t && TEAM_LABELS[t]) return t;
  const d = p.department_id ?? "mechanical";
  if (d === "ppf_tint") return "ppf";
  if (d === "paint") return "painting";
  if (d === "detailing") return "detailing_cleaning";
  if (d === "bodyshop") return "dismantle_refit";
  return "technicians";
}

/** Which side a team belongs to. */
export function sideOfTeam(team: TeamKey): Side {
  return TEAMS.mechanical.some((t) => t.key === team) ? "mechanical" : "bodyshop";
}

const BODYSHOP_DEPARTMENTS = ["bodyshop", "paint", "ppf_tint", "detailing"];
/** Which side a person works on: their team's side when a team is set, else their department's (as sideOfDepartment). */
export function sideOfPerson(p: { department_id?: string | null; team?: string | null }): Side | null {
  const t = p.team as TeamKey | null | undefined;
  if (t && TEAM_LABELS[t]) return sideOfTeam(t);
  if (p.department_id === "mechanical") return "mechanical";
  if (BODYSHOP_DEPARTMENTS.includes(p.department_id ?? "")) return "bodyshop";
  return null;
}

/** The bodyshop section (bodyshop-kinds.ts Section) each team works in, and back. */
export const SECTION_OF_TEAM: Partial<Record<TeamKey, "strip_refit" | "ppf" | "paint" | "detailing">> = { dismantle_refit: "strip_refit", ppf: "ppf", painting: "paint", detailing_cleaning: "detailing" };
export const TEAM_OF_SECTION: Record<string, TeamKey> = { strip_refit: "dismantle_refit", ppf: "ppf", paint: "painting", detailing: "detailing_cleaning" };

/** A team leader leads their team; a manager with a team set (the bodyshop manager, Dismantle & refit) leads it too. */
export function isLeader(p: { role_id?: string | null; team?: string | null }): boolean {
  return p.role_id === "team_leader" || (p.role_id === "workshop_manager" && !!p.team);
}

export type TeamGroup<P> = { side: Side; team: { key: TeamKey; label: string }; members: P[] };
/**
 * THE grouping every staff picker shows: the job's sides in order, each side's teams in TEAMS order, the leaders at
 * the top of their team, then everyone else in the order given (the people source sorts freest first).
 * Empty teams are left out.
 */
export function groupByTeam<P extends { role_id?: string | null; team?: string | null; department_id?: string | null }>(people: P[], sides: Side[]): TeamGroup<P>[] {
  return sides.flatMap((side) =>
    TEAMS[side]
      .map((team) => {
        const members = people.filter((p) => (sideOfPerson(p) ?? sideOfTeam(teamOf(p))) === side && teamOf(p) === team.key);
        return { side, team, members: [...members.filter(isLeader), ...members.filter((p) => !isLeader(p))] };
      })
      .filter((g) => g.members.length > 0),
  );
}

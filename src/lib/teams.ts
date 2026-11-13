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

/* ---------------- Two clean levels (13 November 2026, Section 12) ----------------
 * The form asks Department (Mechanical, Bodyshop, Office), then the Team inside it. The stored department id keeps its
 * finer bodyshop values (paint, ppf_tint, detailing, bodyshop) because rates, sections and scopes read them; it is
 * worked out from the team, never typed. Office has no stored team: its "team" is the role (Advisors, Accounts, ...). */
export type DepartmentLevel = "mechanical" | "bodyshop" | "office";
export const DEPARTMENT_LEVELS: { key: DepartmentLevel; label: string }[] = [
  { key: "mechanical", label: "Mechanical" },
  { key: "bodyshop", label: "Bodyshop" },
  { key: "office", label: "Office" },
];
/** The teams offered inside each level, with the bodyshop labels the owner uses. */
export const LEVEL_TEAMS: Record<DepartmentLevel, { key: TeamKey; label: string }[]> = {
  mechanical: TEAMS.mechanical,
  bodyshop: TEAMS.bodyshop.map((t) => (t.key === "ppf" ? { ...t, label: "PPF and tint" } : t)),
  office: [],
};
/** The level a stored department belongs to. */
export function levelOfDepartment(departmentId: string | null | undefined): DepartmentLevel | null {
  if (!departmentId) return null;
  if (departmentId === "office") return "office";
  if (BODYSHOP_DEPARTMENTS.includes(departmentId)) return "bodyshop";
  return "mechanical";
}
const DEPARTMENT_OF_BODYSHOP_TEAM: Partial<Record<TeamKey, string>> = { dismantle_refit: "bodyshop", ppf: "ppf_tint", painting: "paint", detailing_cleaning: "detailing" };
/** THE stored department of a level and team (Bodyshop > Painting = "paint"; a bodyshop person with no team = "bodyshop"). */
export function storedDepartmentOf(level: DepartmentLevel, team: string | null | undefined): string {
  if (level === "bodyshop") return DEPARTMENT_OF_BODYSHOP_TEAM[team as TeamKey] ?? "bodyshop";
  return level;
}
/** A team that does not sit in the chosen department, in plain words (null = fine). */
export function teamProblem(level: DepartmentLevel, team: string | null | undefined): string | null {
  if (!team) return null;
  if (level === "office") return "Office has no teams: leave the team empty.";
  return LEVEL_TEAMS[level].some((t) => t.key === team) ? null : `Pick a ${level === "bodyshop" ? "Bodyshop" : "Mechanical"} team.`;
}
/** The office "team" shown for a role (Office teams follow the role). */
export const OFFICE_TEAM_OF_ROLE: Record<string, string> = { owner: "Management", service_advisor: "Advisors", accounts: "Accounts", parts: "Parts", gate_in: "Gate-in" };
/**
 * Where an existing person belongs on the two levels (the move list). The team wins when it is set (pickers already
 * treat the person by their team); an office role is always Office.
 */
export function placeOf(p: { role_id: string; department_id: string | null; team: string | null }): { level: DepartmentLevel; team: TeamKey | null; department: string } {
  if (OFFICE_TEAM_OF_ROLE[p.role_id] && p.role_id !== "owner") return { level: "office", team: null, department: "office" };
  const t = p.team && TEAM_LABELS[p.team as TeamKey] ? (p.team as TeamKey) : null;
  if (t) {
    const level: DepartmentLevel = sideOfTeam(t) === "bodyshop" ? "bodyshop" : "mechanical";
    // A mechanical team in a bodyshop department: the department wins for a bodyshop department (the team was a slip).
    if (level === "mechanical" && levelOfDepartment(p.department_id) === "bodyshop") {
      const team = TEAM_OF_SECTION[p.department_id === "paint" ? "paint" : p.department_id === "ppf_tint" ? "ppf" : p.department_id === "detailing" ? "detailing" : "strip_refit"];
      return { level: "bodyshop", team, department: storedDepartmentOf("bodyshop", team) };
    }
    return { level, team: t, department: storedDepartmentOf(level, t) };
  }
  const level = levelOfDepartment(p.department_id) ?? "office";
  if (level === "office") return { level, team: null, department: "office" };
  if (level === "mechanical") return { level, team: ["technician", "team_leader"].includes(p.role_id) ? "technicians" : null, department: "mechanical" };
  const team = TEAM_OF_SECTION[p.department_id === "paint" ? "paint" : p.department_id === "ppf_tint" ? "ppf" : p.department_id === "detailing" ? "detailing" : "strip_refit"];
  return { level, team: ["technician", "team_leader"].includes(p.role_id) ? team : null, department: p.department_id ?? "bodyshop" };
}
/** The title shown for a person: a workshop manager on the bodyshop side is the Bodyshop manager. */
export function roleTitleOf(p: { role_id: string; department_id?: string | null; team?: string | null }, roleLabel: string): string {
  if (p.role_id === "workshop_manager" && (sideOfPerson(p) === "bodyshop" || levelOfDepartment(p.department_id) === "bodyshop")) return "Bodyshop manager";
  return roleLabel;
}
/** "Bodyshop · Painting", "Mechanical · Technicians", "Office · Advisors": the two levels in words (as stored now). */
export function placeWords(p: { role_id: string; department_id?: string | null; team?: string | null }): string {
  const level = levelOfDepartment(p.department_id);
  if (!level) return "";
  const levelLabel = DEPARTMENT_LEVELS.find((d) => d.key === level)!.label;
  if (level === "office") return OFFICE_TEAM_OF_ROLE[p.role_id] ? `${levelLabel} · ${OFFICE_TEAM_OF_ROLE[p.role_id]}` : levelLabel;
  const t = LEVEL_TEAMS[level].find((x) => x.key === p.team);
  return t ? `${levelLabel} · ${t.label}` : levelLabel;
}

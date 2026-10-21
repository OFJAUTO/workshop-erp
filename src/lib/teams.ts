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

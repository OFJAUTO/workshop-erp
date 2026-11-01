/**
 * The team behind each line of work (1 November 2026, J-00969): Mechanical · Electrical (programming, coding, resets) ·
 * Dismantle & refit · Paint · PPF · Detailing & cleaning · Outside work (another company, e.g. PDR). Each line has one;
 * it defaults from the service and the line's words, and the advisor or a manager can change it. The job's sides, its
 * bodyshop stages, the planning's teams and who may be picked all follow from it. Pure: no database.
 */
import type { Side, TeamKey } from "./teams";

export type LineTeam = "mechanical" | "electrical" | "dismantle_refit" | "paint" | "ppf" | "detailing" | "outside";

export type LineTeamDef = {
  key: LineTeam;
  label: string;
  /** The side of the workshop that does it (outside work: none). */
  side: Side | null;
  /** The staff teams (teams.ts) who may be picked for it. */
  staff: TeamKey[];
  /** The bodyshop stages (bodyshop-kinds.ts) it brings on a bodyshop car. */
  stages: string[];
};

export const LINE_TEAMS: LineTeamDef[] = [
  { key: "mechanical", label: "Mechanical", side: "mechanical", staff: ["technicians", "helpers", "electricians"], stages: [] },
  { key: "electrical", label: "Electrical", side: "mechanical", staff: ["electricians"], stages: ["electrical"] },
  { key: "dismantle_refit", label: "Dismantle & refit", side: "bodyshop", staff: ["dismantle_refit"], stages: ["strip", "refit"] },
  { key: "paint", label: "Paint", side: "bodyshop", staff: ["painting"], stages: ["paint"] },
  { key: "ppf", label: "PPF", side: "bodyshop", staff: ["ppf"], stages: ["ppf"] },
  { key: "detailing", label: "Detailing & cleaning", side: "bodyshop", staff: ["detailing_cleaning"], stages: ["detail"] },
  { key: "outside", label: "Outside work", side: null, staff: [], stages: [] },
];
export const LINE_TEAM_KEYS = LINE_TEAMS.map((t) => t.key);
export const lineTeamDef = (k: string | null | undefined) => LINE_TEAMS.find((t) => t.key === k) ?? null;
export const isLineTeam = (k: unknown): k is LineTeam => typeof k === "string" && LINE_TEAM_KEYS.includes(k as LineTeam);
export const LINE_TEAM_LABELS: Record<LineTeam, string> = Object.fromEntries(LINE_TEAMS.map((t) => [t.key, t.label])) as Record<LineTeam, string>;

/** The order of work on a mixed car: dismantle, paint / PPF, refit, electrical and coding, then QC and the wash. */
export const WORK_ORDER: LineTeam[] = ["dismantle_refit", "paint", "ppf", "detailing", "electrical", "mechanical", "outside"];

export type TeamLine = {
  line_type: string;
  title?: string | null;
  team?: string | null;
  side?: string | null;
  outside_work?: boolean | null;
  film_colour?: string | null;
  film_code?: string | null;
  tint_percent?: number | null;
  package_key?: string | null;
};
export type TeamService = { name?: string | null; department?: string | null; bodyshop_kind?: string | null; outside_work?: boolean | null } | null | undefined;

/** Lines with no work behind them have no team (parts, fees, recovery, consumables, discounts). */
const NO_TEAM = new Set(["part", "fee", "recovery", "consumables", "discount"]);

const KIND_TEAM: Record<string, LineTeam> = { ppf: "ppf", coloured_ppf: "ppf", tint: "ppf", ppf_removal: "ppf", peelable_jambs: "paint", peelable_full: "paint", respray: "paint", wash: "detailing", accident: "dismantle_refit" };

/**
 * The team a line gets when nobody chose one: from the service, then from its words, then from its side. The job's
 * department keeps it on its side: on a mechanical job "remove and refit" is the technicians' work, on a bodyshop
 * job plain labour is the bodyshop's; electrical work and outside work stay what they are on any car.
 */
export function defaultTeamOf(l: TeamLine, svc?: TeamService, department?: string | null): LineTeam | null {
  const raw = rawTeamOf(l, svc);
  if (!raw || raw === "electrical" || raw === "outside") return raw;
  if (department === "mechanical") return "mechanical";
  if (department === "bodyshop" && raw === "mechanical") return "dismantle_refit";
  return raw;
}

function rawTeamOf(l: TeamLine, svc?: TeamService): LineTeam | null {
  if (NO_TEAM.has(l.line_type)) return null;
  if (l.outside_work || svc?.outside_work) return "outside";
  const text = `${l.title ?? ""} ${svc?.name ?? ""}`.toLowerCase();
  if (/\bpdr\b|paintless/.test(text)) return "outside";
  if (/program|coding|\bcode\b|reset|calibrat|initiali[sz]|software|adas|radar/.test(text)) return "electrical";
  if (svc?.bodyshop_kind && KIND_TEAM[svc.bodyshop_kind]) return KIND_TEAM[svc.bodyshop_kind];
  if (l.film_colour || l.film_code || /\bppf\b|paint protection|\bwrap|\btint/.test(text)) return "ppf";
  if (l.tint_percent) return "ppf";
  if (/paint|spray|clear ?coat|lacquer|primer|chrome delete/.test(text)) return "paint";
  if (/remove and refit|remove & refit|r ?& ?r\b|dismantl|strip|refit|panel beat|body ?repair|dent/.test(text)) return "dismantle_refit";
  if (/detail|ceramic|polish|valet|deep clean|cleaning|interior clean|wash/.test(text)) return "detailing";
  if (l.side === "bodyshop" || svc?.department === "bodyshop" || l.package_key) return "dismantle_refit";
  return "mechanical";
}

/** The team of a line: the one chosen, else the default. */
export function teamOfLine(l: TeamLine, svc?: TeamService, department?: string | null): LineTeam | null {
  if (NO_TEAM.has(l.line_type)) return null;
  return isLineTeam(l.team) ? l.team : defaultTeamOf(l, svc, department);
}

/** The teams on a car, in the order of work. */
export function teamsOf(lines: { line: TeamLine; svc?: TeamService }[], department?: string | null): LineTeam[] {
  const have = new Set(lines.map((x) => teamOfLine(x.line, x.svc, department)).filter((t): t is LineTeam => !!t));
  return WORK_ORDER.filter((t) => have.has(t));
}

/** The sides those teams work on (outside work is on no side). */
export function sidesOfTeams(teams: LineTeam[]): Side[] {
  const out: Side[] = [];
  if (teams.some((t) => lineTeamDef(t)?.side === "mechanical")) out.push("mechanical");
  if (teams.some((t) => lineTeamDef(t)?.side === "bodyshop")) out.push("bodyshop");
  return out;
}

/** "Bodyshop + Electrical": the Work step's words. The bodyshop teams read as one word; the others by name. */
export function teamsWords(teams: LineTeam[]): string {
  const words: string[] = [];
  if (teams.some((t) => lineTeamDef(t)?.side === "bodyshop")) words.push("Bodyshop");
  if (teams.includes("mechanical")) words.push("Mechanical");
  if (teams.includes("electrical")) words.push("Electrical");
  if (teams.includes("outside")) words.push("Outside work");
  return words.join(" + ");
}

/** The bodyshop stage keys the teams bring (merged with the package kinds' stages by the caller). */
export function stagesOfTeams(teams: LineTeam[]): string[] {
  return Array.from(new Set(teams.flatMap((t) => lineTeamDef(t)?.stages ?? [])));
}

/**
 * The staff teams who may be picked on one side for these line teams; null = no limit (no team known yet). With the
 * teams that have people (present), a team nobody is in yet falls back to anyone on the side: until someone is set as
 * an electrician, the technicians can take a coding line.
 */
export function staffTeamsFor(teams: LineTeam[], side: Side, present?: Set<TeamKey>): TeamKey[] | null {
  const mine = teams.filter((t) => lineTeamDef(t)?.side === side);
  if (!mine.length) return null;
  const want = mine.map((t) => lineTeamDef(t)?.staff ?? []);
  if (present && want.some((staff) => !staff.some((k) => present.has(k)))) return null;
  return Array.from(new Set(want.flat()));
}

/** The bodyshop stage section each bodyshop line team works in. */
export const SECTION_OF_LINE_TEAM: Partial<Record<LineTeam, string>> = { dismantle_refit: "strip_refit", paint: "paint", ppf: "ppf", detailing: "detailing", electrical: "electrical" };
const LINE_TEAM_OF_SECTION: Record<string, LineTeam> = { strip_refit: "dismantle_refit", paint: "paint", ppf: "ppf", detailing: "detailing", electrical: "electrical" };

/** Which team has the car right now: the section of its running (or next) bodyshop stage, else the mechanical work. */
export function teamWithCar(stages: { section: string; status: string }[], mechanicalOpen: boolean): LineTeam | null {
  const s = stages.find((x) => x.status === "active") ?? stages.find((x) => x.status === "pending");
  if (s && LINE_TEAM_OF_SECTION[s.section]) return LINE_TEAM_OF_SECTION[s.section];
  return mechanicalOpen ? "mechanical" : null;
}

/** Customer requests at gate-in: at least one real request, three letters or more ("." or nothing is refused). */
export function realRequests(texts: string[]): string[] {
  return texts.map((t) => t.trim()).filter((t) => (t.match(/[A-Za-z؀-ۿ]/g) ?? []).length >= 3);
}

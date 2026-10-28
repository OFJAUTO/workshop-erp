/**
 * Which side of the workshop a job's work belongs to: mechanical, bodyshop, or both (a mixed job). One rule for the
 * Planning card, the release actions, the work order and the bodyshop stages. Pure: no database.
 */
import { packageParts } from "./packages";
import { isPpfFilmItem, isPpfText } from "./ppf-cut";
import { isTintText } from "./tint";
import type { Side } from "./teams";
export type { Side };

export type SideLine = {
  line_type: string;
  side?: string | null;
  title?: string | null;
  service_id?: string | null;
  package_key?: string | null;
  package_items?: unknown;
  film_colour?: string | null;
  film_code?: string | null;
  tint_percent?: number | null;
};
export type SideService = { department?: string | null; bodyshop_kind?: string | null } | null | undefined;

const NO_SIDE = new Set(["recovery", "fee", "part", "consumables", "discount"]);

/** The bodyshop package kinds (bodyshop-kinds.ts) a line brings; packages are read from their snapshot. */
export function kindsOfLine(l: SideLine, svc?: SideService): string[] {
  if (svc?.bodyshop_kind) return [svc.bodyshop_kind];
  const parts = l.package_items ? packageParts(l.package_items) : null;
  if (parts) {
    const kinds = new Set<string>();
    for (const it of parts.items) {
      if (/remov/i.test(it.label) && isPpfText(it.label)) kinds.add("ppf_removal");
      else if (isPpfFilmItem(it.label)) kinds.add("ppf");
      else if (isTintText(it.label)) kinds.add("tint");
    }
    if (!kinds.size && parts.items.length) kinds.add("other");
    return [...kinds];
  }
  if (l.film_colour || l.film_code) return ["ppf"];
  if (l.tint_percent) return ["tint"];
  if (l.line_type !== "part" && (svc?.department === "bodyshop" || l.side === "bodyshop")) return [l.side === "bodyshop" && l.line_type === "labour" ? "accident" : "other"];
  return [];
}

/** The side one quotation line belongs to, or null for lines that are neither (recovery, fees, parts, plain labour). */
export function lineSideOf(l: SideLine, svc?: SideService): Side | null {
  if (NO_SIDE.has(l.line_type)) return null;
  if (l.side === "bodyshop" || l.side === "mechanical") return l.side;
  if (kindsOfLine(l, svc).length || l.package_key) return "bodyshop";
  if (svc?.department === "bodyshop") return "bodyshop";
  if (svc?.department === "mechanical") return "mechanical";
  return null;
}

/**
 * The sides of a job. The job's department (asked at gate-in, made "both" when bodyshop findings are quoted) is the truth:
 * a bodyshop job is bodyshop only, a mechanical job mechanical only. A "both" job follows its approved work: bodyshop
 * when it has only bodyshop lines, mechanical when it has only mechanical or plain labour lines, otherwise both.
 */
export function sidesOfJob(department: string | null | undefined, lines: { line: SideLine; svc?: SideService }[]): Side[] {
  const sides = lines.map((x) => ({ side: lineSideOf(x.line, x.svc), labour: x.line.line_type === "labour" || x.line.line_type === "package" }));
  const hasBody = sides.some((s) => s.side === "bodyshop");
  const hasMech = sides.some((s) => s.side === "mechanical" || (s.side === null && s.labour));
  if (department === "bodyshop") return ["bodyshop"];
  if (department === "both") {
    if (hasBody && !hasMech) return ["bodyshop"];
    if (hasMech && !hasBody) return ["mechanical"];
    return ["mechanical", "bodyshop"];
  }
  return ["mechanical"];
}

/** The sides a job's department alone gives (before any quotation is approved). */
export function sidesOfDepartment(department: string | null | undefined): Side[] {
  return department === "bodyshop" ? ["bodyshop"] : department === "both" ? ["mechanical", "bodyshop"] : ["mechanical"];
}

export const SIDE_LABEL: Record<Side, string> = { mechanical: "Workshop", bodyshop: "Bodyshop" };
export const SIDE_MANAGER: Record<Side, string> = { mechanical: "the workshop manager", bodyshop: "the bodyshop manager" };

type ReleaseStamps = { department?: string | null; plan_released_at: string | null; plan_bodyshop_released_at?: string | null; bodyshop_started_at?: string | null };
/** Has this side of the job been released? The mechanical release is plan_released_at; the bodyshop's is its own stamp, or its stages having started. */
export function sideReleased(job: ReleaseStamps, side: Side): boolean {
  return side === "bodyshop" ? !!(job.plan_bodyshop_released_at || job.bodyshop_started_at) : !!job.plan_released_at;
}
/**
 * The sides still waiting to be released. Screens that know the approved work pass its sides; lists that do not use the
 * department's sides (a single-sided "both" job is released on both stamps by its release action, so both agree).
 */
export function sidesToRelease(job: ReleaseStamps, sides: Side[] = sidesOfDepartment(job.department)): Side[] {
  return sides.filter((s) => !sideReleased(job, s));
}

/** What the manager is asked to do when the parts are sorted, by the job's department. */
export function releaseWords(department: string | null | undefined): string {
  if (department === "bodyshop") return "Pick the start day and the bodyshop team, then Release to bodyshop.";
  if (department === "both") return "Each manager picks the start day and their people, then releases their side (workshop and bodyshop).";
  return "Pick the start day and the technicians, then Release to workshop.";
}

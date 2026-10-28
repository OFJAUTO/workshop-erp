/**
 * What a person may do in the bodyshop (28 October 2026, B2). One rule for every bodyshop screen and server action:
 * the owner and the bodyshop manager act on everything; a team leader only on their own team - its stages, its
 * people, its products. Pure: no database.
 */
import type { StageSection } from "./bodyshop-kinds";
import { SECTION_OF_TEAM, isLeader, sideOfPerson, teamOf, type TeamKey } from "./teams";

export type BodyshopScope =
  | { kind: "all" }
  | { kind: "team"; team: TeamKey; section: "strip_refit" | "ppf" | "paint" | "detailing" }
  | { kind: "none" };

type Who = { role_id: string; department_id?: string | null; team?: string | null; viewingAs?: unknown };

/** The owner, the bodyshop manager (all), a team leader (their team), anyone else (nothing). Viewing as someone acts on nothing. */
export function bodyshopScopeOf(staff: Who): BodyshopScope {
  if (staff.viewingAs) return { kind: "none" };
  if (staff.role_id === "owner") return { kind: "all" };
  if (staff.role_id === "workshop_manager" && sideOfPerson(staff) === "bodyshop") return { kind: "all" };
  if (staff.role_id === "team_leader") {
    const team = teamOf(staff);
    const section = SECTION_OF_TEAM[team];
    return section ? { kind: "team", team, section } : { kind: "none" };
  }
  return { kind: "none" };
}

/** A stage of this section: its leader signs it off; QC, the electrical reset and the handover are the manager's. */
export function mayActOnSection(scope: BodyshopScope, section: StageSection | string): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "none") return false;
  return section === scope.section;
}

/** Putting a person on a car, or clocking them: a leader only within their own team (themselves included). */
export function mayPickPerson(scope: BodyshopScope, person: { role_id?: string | null; department_id?: string | null; team?: string | null }): boolean {
  if (scope.kind === "none") return false;
  if (sideOfPerson(person) !== "bodyshop" && !(person.role_id === "workshop_manager" && person.team)) return false;
  if (scope.kind === "all") return true;
  return teamOf(person) === scope.team;
}

/** Materials and warranty details by product: film and tint are the PPF team's, ceramic the detailing team's. */
export function mayEnterProduct(scope: BodyshopScope, product: "ppf" | "tint" | "ceramic"): boolean {
  if (scope.kind === "all") return true;
  if (scope.kind === "none") return false;
  return product === "ceramic" ? scope.section === "detailing" : scope.section === "ppf";
}

/** The 10-day after-care check is signed by the PPF leader (or the bodyshop manager, or the owner). */
export const maySignAftercare = (scope: BodyshopScope) => scope.kind === "all" || (scope.kind === "team" && scope.section === "ppf");

/** Manager-only bodyshop work: strip and refit items, customer updates, the assessment, QC, due dates, stages. */
export const isBodyshopManagerScope = (scope: BodyshopScope) => scope.kind === "all";

export { isLeader };

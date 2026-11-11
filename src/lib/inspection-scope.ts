/**
 * THE INSPECTION TYPE AND "COULD NOT CHECK" (11 November 2026, Section 10). Pure.
 * - The advisor picks the type before the inspection can start (no default): Full / Customer complaints only /
 *   Pre-purchase. Complaints only checks the customer's complaints (plus anything noticed while working).
 * - The technician's first tap is the car's condition; an item that needs the engine running, driving or battery power
 *   is marked "Could not check" by itself when the condition says it is impossible (he can override it).
 * - Any item can be "Could not check" with a one-tap reason (always required).
 * - The report never says "complete" while items wait: "Full inspection: 34 checked · 6 pending".
 */
export const SCOPES = [
  { key: "full", label: "Full inspection" },
  { key: "complaints", label: "Customer complaints only" },
  { key: "pre_purchase", label: "Pre-purchase inspection" },
] as const;
export type Scope = (typeof SCOPES)[number]["key"];
export const isScope = (v: unknown): v is Scope => SCOPES.some((s) => s.key === v);
export const scopeLabel = (s: string | null | undefined) => (isScope(s) ? SCOPES.find((x) => x.key === s)!.label : "Type: not set");

/** The report's title for the customer. */
export function reportTitleOf(scope: string | null | undefined): { title: string; note: string | null } {
  if (scope === "complaints") return { title: "INSPECTION REPORT – CUSTOMER REQUESTS ONLY", note: "OTHER SYSTEMS WERE NOT CHECKED." };
  if (scope === "pre_purchase") return { title: "PRE-PURCHASE INSPECTION REPORT", note: null };
  return { title: "INSPECTION REPORT", note: null };
}

/** A smaller scope after the start needs the owner; a bigger one is just logged. */
export const SCOPE_SIZE: Record<Scope, number> = { complaints: 1, full: 2, pre_purchase: 3 };
export const isDowngrade = (from: Scope | null, to: Scope) => !!from && SCOPE_SIZE[to] < SCOPE_SIZE[from];

export const CONDITIONS = [
  { key: "drives", label: "Starts and drives" },
  { key: "starts_no_drive", label: "Starts but can't be driven" },
  { key: "no_start", label: "Doesn't start" },
  { key: "no_power", label: "No power" },
] as const;
export type Condition = (typeof CONDITIONS)[number]["key"];
export const isCondition = (v: unknown): v is Condition => CONDITIONS.some((c) => c.key === v);

export type Need = "engine" | "driving" | "power";
const NEED_WORDS: Record<Need, string> = { engine: "engine not running", driving: "car can't be driven", power: "no battery power" };

/**
 * What a checklist item needs, from its key and name: driving (road test, gearbox shifting, steering feel, brakes in
 * use, noises on the move), the engine running (idle, A/C cooling, oil pressure, exhaust smoke, charging), battery
 * power (lights, electrics, screens, windows). Nothing = it can be checked standing.
 */
export function needsOf(item: { key: string; label: string; sectionKey?: string | null }): Need[] {
  const t = `${item.key} ${item.label} ${item.sectionKey ?? ""}`.toLowerCase();
  const out = new Set<Need>();
  if (/road|drive|driving|gear ?shift|shifting|clutch|steering feel|wheel alignment|vibration|brak(e|ing) (feel|performance)|cruise|acceleration/.test(t)) out.add("driving");
  if (/engine (noise|idle|running|performance)|idle|a\/?c (cool|perform)|cooling|oil pressure|exhaust smoke|smoke|charging|alternator|turbo|misfire|warning light/.test(t)) out.add("engine");
  if (/light|lamp|electric|window|mirror|screen|display|infotainment|radio|camera|sensor|horn|wiper|central lock|seat (motor|heater)|battery/.test(t)) out.add("power");
  if (out.has("driving")) { out.add("engine"); out.add("power"); }
  if (out.has("engine")) out.add("power");
  return Array.from(out);
}

/** What the car's condition makes impossible. */
export function impossibleNeeds(c: Condition | null | undefined): Need[] {
  if (c === "starts_no_drive") return ["driving"];
  if (c === "no_start") return ["driving", "engine"];
  if (c === "no_power") return ["driving", "engine", "power"];
  return [];
}

/** The automatic "Could not check" reason for an item under a condition, or null when it can be checked. */
export function autoNotCheckedReason(item: { key: string; label: string; sectionKey?: string | null }, c: Condition | null | undefined): string | null {
  const blocked = needsOf(item).filter((n) => impossibleNeeds(c).includes(n));
  if (!blocked.length) return null;
  // The strongest reason wins: no power, else engine not running, else can't be driven.
  const why: Need = blocked.includes("power") && impossibleNeeds(c).includes("power") ? "power" : blocked.includes("engine") ? "engine" : "driving";
  return NEED_WORDS[why];
}

/** The one-tap reasons a technician gives for any item. */
export const NOT_CHECKED_REASONS = ["Needs dismantling first", "Access blocked", "Part missing", "Needs dealer login", "Engine not running", "Car can't be driven", "No battery power", "Other"] as const;

export type NotChecked = { key: string; reason: string; auto: boolean; resolution: "checked" | "declined" | "not_applicable" | null };
/** Still to check: not settled. */
export const pendingOf = <T extends NotChecked>(items: T[]): T[] => items.filter((i) => !i.resolution);

/** "Full inspection: 34 checked · 6 pending" - never "complete" while items wait. */
export function scopeStatusWords(scope: string | null | undefined, checked: number, pending: number): string {
  return `${scopeLabel(scope)}: ${checked} checked${pending ? ` · ${pending} pending` : ""}`;
}

/** "Car now runs: 6 items still to check". */
export const nowRunsWords = (n: number) => `Car now runs: ${n} item${n === 1 ? "" : "s"} still to check`;

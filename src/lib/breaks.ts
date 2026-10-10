import { parseBreak, type BreakWindow, type WorkingTime } from "./working-time";

/** The settings keys that carry the two departments' breaks. */
export type BreakSettings = { break_mechanical?: unknown; break_bodyshop?: unknown };

/** The department's break, from Settings: bodyshop sides take the bodyshop one, everyone else the mechanical one. */
export function departmentBreak(settings: BreakSettings, departmentId: string | null | undefined): BreakWindow | null {
  const bodyshop = departmentId === "bodyshop" || departmentId === "paint" || departmentId === "ppf_tint";
  return parseBreak(String((bodyshop ? settings.break_bodyshop : settings.break_mechanical) ?? "")) ?? (bodyshop ? { start: "13:30", end: "14:30" } : { start: "12:30", end: "13:30" });
}

/** A person's break: his own times from Team when set, else his department's. */
export function breakOf(settings: BreakSettings, person: { department_id?: string | null; break_start?: string | null; break_end?: string | null } | null | undefined): BreakWindow | null {
  if (person?.break_start && person?.break_end) {
    const own = parseBreak(`${person.break_start}-${person.break_end}`);
    if (own) return own;
  }
  return departmentBreak(settings, person?.department_id ?? null);
}

/** Working time with the department's break taken out, for load bars, finish dates and timers. */
export function withBreak(wt: WorkingTime, brk: BreakWindow | null): WorkingTime {
  return brk ? { ...wt, breakStart: brk.start, breakEnd: brk.end } : wt;
}

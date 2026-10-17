import { DAY_IDS, parseBreak, type BreakLike, type BreakSchedule, type BreakWindow, type WorkingTime, breakForDay, dubaiDayId } from "./working-time";

/** The settings keys that carry the breaks: the per-weekday grid, and the two old single windows as fallback. */
export type BreakSettings = { break_times?: unknown; break_mechanical?: unknown; break_bodyshop?: unknown };

const BODYSHOP_DEPARTMENTS = new Set(["bodyshop", "paint", "ppf_tint", "detailing"]);
/** The built-in times (Settings > Breaks changes them): Saturday to Thursday one hour per side, Friday 12:30-14:00 for both. */
const FALLBACK: Record<"mechanical" | "bodyshop", { usual: string; fri: string }> = {
  mechanical: { usual: "12:30-13:30", fri: "12:30-14:00" },
  bodyshop: { usual: "13:30-14:30", fri: "12:30-14:00" },
};

function sideOf(departmentId: string | null | undefined): "mechanical" | "bodyshop" {
  return BODYSHOP_DEPARTMENTS.has(String(departmentId ?? "")) ? "bodyshop" : "mechanical";
}

/** The department's break for every day of the week, from Settings > Breaks ("" on a day means no break that day). */
export function departmentBreakSchedule(settings: BreakSettings, departmentId: string | null | undefined): BreakSchedule {
  const side = sideOf(departmentId);
  const grid = ((settings.break_times as Record<string, Record<string, string>> | null) ?? {})[side] ?? {};
  const legacy = parseBreak(String((side === "bodyshop" ? settings.break_bodyshop : settings.break_mechanical) ?? ""));
  const out: BreakSchedule = {};
  for (const day of DAY_IDS) {
    if (typeof grid[day] === "string") out[day] = parseBreak(grid[day]); // "" or bad text = no break that day.
    else out[day] = day === "fri" ? parseBreak(FALLBACK[side].fri) : legacy ?? parseBreak(FALLBACK[side].usual);
  }
  return out;
}

/** The department's break on one day (today unless given). */
export function departmentBreak(settings: BreakSettings, departmentId: string | null | undefined, now = Date.now()): BreakWindow | null {
  return breakForDay(departmentBreakSchedule(settings, departmentId), dubaiDayId(now));
}

/** A person's break: his own times from Team on every day when set, else his department's per-day schedule. */
export function breakOf(settings: BreakSettings, person: { department_id?: string | null; break_start?: string | null; break_end?: string | null } | null | undefined): BreakLike {
  if (person?.break_start && person?.break_end) {
    const own = parseBreak(`${person.break_start}-${person.break_end}`);
    if (own) return own;
  }
  return departmentBreakSchedule(settings, person?.department_id ?? null);
}

/** Working time with the break taken out (one window, or the per-day schedule), for load bars, finish dates and timers. */
export function withBreak(wt: WorkingTime, brk: BreakLike): WorkingTime {
  if (!brk) return wt;
  if (typeof (brk as BreakWindow).start === "string") return { ...wt, breakStart: (brk as BreakWindow).start, breakEnd: (brk as BreakWindow).end, breaks: null };
  return { ...wt, breaks: brk as BreakSchedule, breakStart: null, breakEnd: null };
}

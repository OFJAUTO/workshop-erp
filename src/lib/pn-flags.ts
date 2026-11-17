import "server-only";
import { createAdminClient } from "./supabase/admin";
import { pageAll } from "./page-all";
import { madeUpPartNumber, madeUpWords } from "./part-number-check";
import { formatPlate } from "./types";

/*
 * MADE-UP PART NUMBERS (17 November 2026, Section 7): the parts on cars still in the workshop whose part number is not a
 * real one (THE rule in part-number-check.ts), by car and by who typed it. The owner gets the count in his daily summary
 * and the list once a week; the page /parts/part-number-check shows it any time.
 */

export type PnFlag = { partId: string; jobId: string; jobNumber: string; car: string; part: string; partNumber: string; why: string; typedBy: string | null };

export async function flaggedPartNumbers(): Promise<PnFlag[]> {
  const admin = createAdminClient();
  type Row = { id: string; job_id: string; description: string; part_number: string | null; priced_by: string | null; updated_by: string | null; created_by: string | null };
  const rows = await pageAll<Row>((a, b) => admin.from("part_items").select("id, job_id, description, part_number, priced_by, updated_by, created_by").eq("is_active", true).not("part_number", "is", null).is("removed_at", null).order("id").range(a, b) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>);
  const flagged = rows.filter((r) => madeUpPartNumber(r.part_number, r.description));
  if (!flagged.length) return [];
  const jobIds = Array.from(new Set(flagged.map((r) => r.job_id)));
  const staffIds = Array.from(new Set(flagged.map((r) => r.priced_by ?? r.updated_by ?? r.created_by).filter((x): x is string => !!x)));
  const [{ data: jobs }, { data: ppl }] = await Promise.all([
    admin.from("jobs").select("id, job_number, is_open, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number)").in("id", jobIds),
    staffIds.length ? admin.from("staff").select("id, display_name").in("id", staffIds) : Promise.resolve({ data: [] }),
  ]);
  const jobOf = new Map(((jobs ?? []) as unknown as { id: string; job_number: string; is_open: boolean; vehicle: Parameters<typeof formatPlate>[0] | null }[]).map((j) => [j.id, j]));
  const who = new Map(((ppl ?? []) as { id: string; display_name: string }[]).map((p) => [p.id, p.display_name]));
  return flagged
    .filter((r) => jobOf.get(r.job_id)?.is_open)
    .map((r) => {
      const j = jobOf.get(r.job_id)!;
      const by = r.priced_by ?? r.updated_by ?? r.created_by;
      return { partId: r.id, jobId: r.job_id, jobNumber: j.job_number, car: j.vehicle ? formatPlate(j.vehicle) : "", part: r.description.toUpperCase(), partNumber: String(r.part_number), why: madeUpWords(r.part_number, r.description) ?? "", typedBy: by ? who.get(by) ?? null : null };
    })
    .sort((a, b) => a.jobNumber.localeCompare(b.jobNumber));
}

/**
 * The owner's daily count (evening summary hour) and the weekly list (Mondays). Once each: the count once a day, the list
 * once a week. Returns what was sent.
 */
export async function pnFlagsOwnerSummary(nowMs = Date.now()): Promise<{ daily: number; weekly: number }> {
  const { SUMMARY_HOUR, dubaiClock } = await import("./password-alert-rules");
  const { hour, dayStartIso } = dubaiClock(nowMs);
  const out = { daily: 0, weekly: 0 };
  if (hour < SUMMARY_HOUR) return out;
  const list = await flaggedPartNumbers();
  if (!list.length) return out;
  const admin = createAdminClient();
  const { data: owners } = await admin.from("staff").select("id").eq("role_id", "owner").eq("is_active", true);
  const ids = ((owners ?? []) as { id: string }[]).map((o) => o.id);
  if (!ids.length) return out;
  const { notifyStaff } = await import("./notifications");
  const { count: today } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("type", "pn_flags_count").in("staff_id", ids).gte("created_at", dayStartIso);
  if (!(today ?? 0)) {
    await notifyStaff(ids, { type: "pn_flags_count", title: `${list.length} part number${list.length === 1 ? "" : "s"} look made up`, body: `On cars in the workshop (like ${list.slice(0, 3).map((f) => f.partNumber).join(", ")}). The list is on Parts → Part number check.`, href: "/parts/part-number-check" });
    out.daily = list.length;
  }
  // Mondays: the whole list, by car and who typed it.
  const dubaiDay = new Date(nowMs + 4 * 3600000).getUTCDay();
  if (dubaiDay === 1) {
    const weekStart = new Date(Date.parse(dayStartIso) - 6 * 86400000).toISOString();
    const { count: week } = await admin.from("notifications").select("id", { count: "exact", head: true }).eq("type", "pn_flags_weekly").in("staff_id", ids).gte("created_at", weekStart);
    if (!(week ?? 0)) {
      const body = list.slice(0, 25).map((f) => `${f.jobNumber} ${f.car}: ${f.part} "${f.partNumber}"${f.typedBy ? ` (${f.typedBy})` : ""}`).join("\n");
      await notifyStaff(ids, { type: "pn_flags_weekly", title: `Weekly: ${list.length} made-up part number${list.length === 1 ? "" : "s"}`, body, href: "/parts/part-number-check" });
      out.weekly = list.length;
    }
  }
  return out;
}

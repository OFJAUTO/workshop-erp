"use server";

import { revalidatePath } from "next/cache";
import { dbWords } from "@/lib/app-errors";
import { requireStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { moveTargets, partsToAddHere, PREPARING_STATUSES } from "@/lib/part-quote";
import { partQuoteMap } from "@/lib/part-quote-data";
import { syncPartLine } from "@/lib/quote-versions";

/**
 * WHICH QUOTATION A PART IS FOR (11 November 2026, Section 2). The parts desk moves a part (or an open request) to
 * another of the job's quotations still being prepared; the advisor pulls priced parts onto the quotation with one
 * tap ("Add here"). A part on an APPROVED quotation never moves (a revision does that). A priced part lands as a line
 * by itself, marked "priced by parts desk"; its line on the quotation it left (a draft) is taken off.
 */
export type PartQuoteState = { ok?: boolean; error?: string; message?: string } | null;

async function moveOne(jobId: string, ref: { partId?: string | null; requestId?: string | null }, number: string, by: string): Promise<string | null> {
  const admin = createAdminClient();
  const map = await partQuoteMap(jobId);
  if (!map.ready) return "Moving parts between quotations switches on once the database change is applied.";
  const target = map.quotes.find((q) => q.number === number);
  if (!target) return `${number} is not a quotation of this job.`;
  if (ref.partId) {
    const facts = map.partFacts.get(ref.partId);
    if (!facts) return "That part is no longer on this job.";
    const current = map.partOf.get(ref.partId) ?? null;
    if (current === number) return null;
    const onLocked = facts.lineNumbers.some((n) => !PREPARING_STATUSES.includes(map.quotes.find((q) => q.number === n)?.status ?? "draft"));
    if (!moveTargets(current, map.quotes, { onLockedLine: onLocked }).some((q) => q.number === number)) {
      return onLocked ? `This part is already on ${facts.lineNumbers.join(", ")} (approved or with the customer): only a revision moves it.` : `${number} is not being prepared: a part can only join a quotation that is still a draft.`;
    }
    const { data: part } = await admin.from("part_items").select("id, part_request_id").eq("id", ref.partId).maybeSingle();
    const { error } = await admin.from("part_items").update({ for_quote: number, updated_by: by }).eq("id", ref.partId);
    if (error) return dbWords(error, "parts/move-quote", { staffId: by });
    if (part?.part_request_id) await admin.from("part_requests").update({ for_quote: number, updated_by: by }).eq("id", part.part_request_id);
    // Its line on the draft it leaves comes off; then the line on the new one (a priced part only: syncPartLine adds nothing for an unpriced one).
    const leaving = map.quotes.filter((q) => q.number !== number && facts.lineNumbers.includes(q.number) && PREPARING_STATUSES.includes(q.status));
    for (const q of leaving) await admin.from("quotation_lines").update({ is_active: false, updated_by: by }).eq("quotation_id", q.newestId).eq("part_item_id", ref.partId).eq("is_active", true);
    await syncPartLine(jobId, ref.partId, by, target.newestId);
    await admin.from("job_events").insert({ job_id: jobId, event_type: "part_quote_moved", note: `A part moved to ${number}${current ? ` (from ${current})` : ""}`, created_by: by });
    return null;
  }
  if (ref.requestId) {
    const { error } = await admin.from("part_requests").update({ for_quote: number, updated_by: by }).eq("id", ref.requestId).eq("job_id", jobId);
    if (error) return dbWords(error, "parts/move-quote", { staffId: by });
    await admin.from("part_items").update({ for_quote: number, updated_by: by }).eq("part_request_id", ref.requestId).eq("job_id", jobId);
    return null;
  }
  return "Nothing to move.";
}

/** The parts desk's "For quotation …" choice on one row. */
export async function movePartToQuote(jobId: string, ref: { partId?: string | null; requestId?: string | null }, number: string): Promise<PartQuoteState> {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!(can(role, "priceParts") || can(role, "editQuotes")) || staff.viewingAs) return { error: "Only the parts desk, the advisors or the owner move a part to another quotation." };
  const err = await moveOne(jobId, ref, number, staff.id);
  if (err) return { error: err };
  revalidatePath(`/parts/${jobId}`);
  revalidatePath(`/jobs/${jobId}`, "layout");
  return { ok: true, message: `Now for ${number}.` };
}

/** The advisor's "Add here" on a quotation: every listed priced part joins this quotation as a line. */
export async function addPartsHere(jobId: string, quotationId: string, partIds: string[]): Promise<PartQuoteState> {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (!can(role, "editQuotes") || staff.viewingAs) return { error: "Only an advisor or the owner adds parts to a quotation." };
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, number, job_id, status").eq("id", quotationId).maybeSingle();
  if (!q || q.job_id !== jobId) return { error: "That quotation is not on this job." };
  if (!PREPARING_STATUSES.includes(q.status as string)) return { error: "Parts can only be added while the quotation is being prepared." };
  // Only parts the rule still offers here (a part approved or sent elsewhere meanwhile is skipped).
  const map = await partQuoteMap(jobId);
  const { data: rows } = await admin.from("part_items").select("id, cost_aed, is_active").eq("job_id", jobId).in("id", partIds);
  const offered = partsToAddHere(((rows ?? []) as { id: string; cost_aed: number | null; is_active: boolean }[]).map((p) => ({ id: p.id, priced: Number(p.cost_aed) > 0, live: p.is_active !== false, ...(map.partFacts.get(p.id) ?? { tag: null, lineNumbers: [] }) })), q.number as string, map.quotes);
  let n = 0;
  for (const p of offered) {
    const err = await moveOne(jobId, { partId: p.id }, q.number as string, staff.id);
    if (!err) n++;
  }
  revalidatePath(`/jobs/${jobId}`, "layout");
  revalidatePath(`/parts/${jobId}`);
  if (!n) return { error: "Nothing was added: those parts are on another quotation now." };
  return { ok: true, message: `${n} part${n === 1 ? "" : "s"} added to ${q.number}.` };
}

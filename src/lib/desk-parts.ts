import "server-only";
import { createAdminClient } from "./supabase/admin";
import { schemaReady } from "./schema-ready";
import { logAppError, SAVE_FAILED } from "./app-errors";
import { notifyRoles, notifyStaff } from "./notifications";
import { getSettings } from "./settings";
import { refreshQuoteTotals } from "./quote-data";
import { quoteLeadIds } from "./quote-lead";
import { deskRowWords, type DeskPart } from "./desk-parts-rules";

/*
 * "+ ADD A PART" ON AN ESTIMATE BY THE PARTS DESK (13 November 2026, Section 5, E-00092). The part becomes a line on
 * the estimate tagged "Added by Parts" (it can name the job it is for), left off until the advisor decides: Accept
 * puts it on the estimate, Decline leaves it off. An estimate already sent or approved is never changed here: the
 * advisor is asked to revise it with the part. The desk sees "Accepted by <advisor>" or "Declined" on the row.
 */
export const DESK_PREPARING = ["draft", "pending_owner"];
export type Actor = { id: string; display_name: string; role_id: string };
export { deskRowWords };

export async function deskPartsReady(): Promise<boolean> {
  return schemaReady("quotation_lines", "parts_add_status, parts_added_at, parts_added_by, parts_add_decided_by");
}

async function leadsOf(estimateId: string): Promise<string[]> {
  const { data: q } = await createAdminClient().from("quotations").select("kind, number, created_by, job_id").eq("id", estimateId).maybeSingle();
  if (!q) return [];
  return quoteLeadIds(q as never).catch(() => (q.created_by ? [String(q.created_by)] : []));
}

export type DeskEntry = { name: string; qty: number; positions?: string[] };
export type DeskAnswer = { ok?: boolean; error?: string; words?: string; revise?: boolean };

export async function addDeskParts(estimateId: string, entries: DeskEntry[], forLineId: string | null, by: Actor): Promise<DeskAnswer> {
  if (!["parts", "owner"].includes(by.role_id)) return { error: "Only the parts desk or the owner adds a part here." };
  if (!(await deskPartsReady())) return { error: "Adding a part on an estimate switches on with the database update (waiting for apply)." };
  const clean = entries
    .map((e) => ({ name: String(e.name ?? "").trim().slice(0, 3000), qty: Math.max(0.01, Number(e.qty) || 1), positions: Array.isArray(e.positions) ? e.positions.map(String) : [] }))
    .filter((e) => e.name);
  if (!clean.length) return { error: "Pick or type the part first." };
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, number, kind, status, carried_job_id, is_active").eq("id", estimateId).maybeSingle();
  if (!q || q.kind !== "estimate" || q.is_active === false) return { error: "That estimate was not found." };
  if (q.carried_job_id) return { error: `${q.number} became the job's quotation: add the part on the job's parts page.` };
  let forTitle: string | null = null;
  if (forLineId) {
    const { data: parent } = await admin.from("quotation_lines").select("id, title, quotation_id").eq("id", forLineId).maybeSingle();
    if (!parent || parent.quotation_id !== estimateId) return { error: "That job is not on this estimate." };
    forTitle = String(parent.title);
  }
  const names = clean.map((e) => `${e.name.toUpperCase()} × ${e.qty}`).join(", ");
  const forWords = forTitle ? ` (for job: ${forTitle.toUpperCase()})` : "";
  const leads = (await leadsOf(estimateId)).filter((id) => id !== by.id);
  if (!DESK_PREPARING.includes(String(q.status))) {
    // Sent or approved: the customer's estimate never changes from here - the advisor revises it with the part.
    await admin.from("quotation_events").insert({ quotation_id: estimateId, event_type: "parts_add_requested", note: `Parts (${by.display_name}) want to add ${names}${forWords}: ${q.number} was already sent, revise it to add the part.`, created_by: by.id });
    if (leads.length) await notifyStaff(leads, { type: "estimate_parts_priced", title: `Revise ${q.number}: Parts want to add a part`, body: `${by.display_name} wants to add ${names}${forWords}. ${q.number} was already sent, so it needs a new version.`, href: `/estimates/${estimateId}` });
    return { ok: true, revise: true, words: `${q.number} was already sent to the customer, so it needs a revision: the advisor is asked to add ${names}.` };
  }
  const { data: maxRow } = await admin.from("quotation_lines").select("position").eq("quotation_id", estimateId).order("position", { ascending: false }).limit(1).maybeSingle();
  let position = Number(maxRow?.position ?? 0);
  const now = new Date().toISOString();
  const rows = clean.map((e) => ({
    quotation_id: estimateId, position: ++position, line_type: "part", title: e.name, source_type: "manual", quantity: e.qty, positions: e.positions,
    left_off: true, price_requested_at: now, price_requested_by: by.id, parts_added_at: now, parts_added_by: by.id, parts_add_status: "pending",
    parent_line_id: forLineId, created_by: by.id, updated_by: by.id,
  }));
  const { error } = await admin.from("quotation_lines").insert(rows, { defaultToNull: false });
  if (error) {
    logAppError("desk-parts.add", error, { staffId: by.id, detail: { estimateId } });
    return { error: SAVE_FAILED };
  }
  await admin.from("quotation_events").insert({ quotation_id: estimateId, event_type: "parts_added_by_desk", note: `Added by Parts (${by.display_name}): ${names}${forWords}. Waiting for the advisor to accept or decline.`, created_by: by.id });
  if (leads.length) await notifyStaff(leads, { type: "estimate_parts_priced", title: `Parts added a part to ${q.number}`, body: `${by.display_name} added ${names}${forWords}. Accept or decline it on the estimate.`, href: `/estimates/${estimateId}#desk-parts` });
  return { ok: true, words: `${names} added to ${q.number}. Price it here; the advisor accepts or declines it.` };
}

type Row = { id: string; title: string; quantity: number | string; parts_add_status: DeskPart["status"]; parent_line_id: string | null; parts_added_by: string | null; parts_add_decided_by: string | null };

/** Every part the desk added to this estimate, with its job, who added it and who decided. */
export async function deskPartsOf(estimateId: string): Promise<DeskPart[]> {
  if (!(await deskPartsReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("quotation_lines").select("id, title, quantity, parts_add_status, parent_line_id, parts_added_by, parts_add_decided_by").eq("quotation_id", estimateId).eq("is_active", true).not("parts_add_status", "is", null).order("position");
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return [];
  const parentIds = rows.map((r) => r.parent_line_id).filter((x): x is string => !!x);
  const staffIds = Array.from(new Set(rows.flatMap((r) => [r.parts_added_by, r.parts_add_decided_by]).filter((x): x is string => !!x)));
  const [{ data: parents }, { data: staff }] = await Promise.all([
    parentIds.length ? admin.from("quotation_lines").select("id, title").in("id", parentIds) : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    staffIds.length ? admin.from("staff").select("id, display_name").in("id", staffIds) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
  ]);
  const t = new Map(((parents ?? []) as { id: string; title: string }[]).map((p) => [p.id, p.title]));
  const n = new Map(((staff ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  return rows.map((r) => ({
    id: r.id, title: r.title, quantity: Number(r.quantity) || 1, status: r.parts_add_status,
    forJob: r.parent_line_id ? t.get(r.parent_line_id) ?? null : null,
    addedBy: r.parts_added_by ? n.get(r.parts_added_by) ?? null : null,
    decidedBy: r.parts_add_decided_by ? n.get(r.parts_add_decided_by) ?? null : null,
  }));
}

/** The advisor's (or the owner's) Accept or Decline of a part the desk added. */
export async function decideDeskPart(lineId: string, accept: boolean, by: Actor): Promise<DeskAnswer> {
  if (!["service_advisor", "owner"].includes(by.role_id)) return { error: "The advisor or the owner accepts or declines a part the desk added." };
  if (!(await deskPartsReady())) return { error: "This switches on with the database update (waiting for apply)." };
  const admin = createAdminClient();
  const { data: l } = await admin.from("quotation_lines").select("id, quotation_id, title, parts_add_status, parts_added_by").eq("id", lineId).maybeSingle();
  if (!l || l.parts_add_status !== "pending") return { error: "That part was already decided." };
  const { data: q } = await admin.from("quotations").select("id, number, status").eq("id", l.quotation_id).maybeSingle();
  if (!q || !DESK_PREPARING.includes(String(q.status))) return { error: `${q?.number ?? "The estimate"} was already sent: revise it to change its parts.` };
  const now = new Date().toISOString();
  const { data: done, error } = await admin
    .from("quotation_lines")
    .update({ parts_add_status: accept ? "accepted" : "declined", parts_add_decided_at: now, parts_add_decided_by: by.id, ...(accept ? { left_off: false } : {}), updated_by: by.id })
    .eq("id", lineId)
    .eq("parts_add_status", "pending")
    .select("id");
  if (error || !(done ?? []).length) {
    if (error) logAppError("desk-parts.decide", error, { staffId: by.id, detail: { lineId } });
    return { error: SAVE_FAILED };
  }
  await refreshQuoteTotals(String(l.quotation_id), await getSettings(), by.id).catch(() => null);
  const title = String(l.title).toUpperCase();
  const words = accept ? `${title} accepted onto ${q.number} by ${by.display_name}` : `${title} declined by ${by.display_name} (left off ${q.number})`;
  await admin.from("quotation_events").insert({ quotation_id: l.quotation_id, event_type: accept ? "parts_add_accepted" : "parts_add_declined", note: words, created_by: by.id });
  const msg = { type: "estimate_parts_priced", title: `${accept ? "Accepted" : "Declined"}: ${title} · ${q.number}`, body: words, href: `/parts/estimate/${l.quotation_id}` };
  if (l.parts_added_by && l.parts_added_by !== by.id) await notifyStaff([String(l.parts_added_by)], msg);
  else if (!l.parts_added_by) await notifyRoles(["parts"], msg);
  return { ok: true, words };
}

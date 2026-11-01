import "server-only";
import { jobAdvisorIds, notifyStaff } from "./notifications";
import { LINE_SELECT, logQuoteEvent } from "./quote-data";
import { afterOf, handbackStands, handbackSummary, handbackWords, snapshotOf, type HandbackKind, type Snapshot } from "./quote-handback";
import { schemaReady } from "./schema-ready";
import { createAdminClient } from "./supabase/admin";
import { formatPlate } from "./types";

/**
 * Who is in charge of an estimate or quotation (1 November 2026, E-00055): the advisor who STARTED it - the creator of
 * its first version - whoever edits, revises or approves it later. A job's quotation also belongs to the car's
 * advisors in charge. The owner's own edits never move it to him.
 */

/** Migration 20261202100000_quote_handback: the owner's handback and the "before" snapshot. */
export const handbackReady = () => schemaReady("quotations", "handback_baseline, handed_back_at, handed_back_by, handback_kind, handback_summary");
export const HANDBACK_SELECT = "handback_baseline, handed_back_at, handed_back_by, handback_kind, handback_summary";

/** The advisor who started each number: the creator of its lowest version (deleted or superseded versions count). */
export async function startersOf(numbers: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const list = Array.from(new Set(numbers.filter(Boolean)));
  if (!list.length) return out;
  const { data } = await createAdminClient().from("quotations").select("number, version, created_by").in("number", list).order("version", { ascending: true });
  for (const r of (data ?? []) as { number: string; version: number; created_by: string | null }[]) if (r.created_by && !out.has(r.number)) out.set(r.number, r.created_by);
  return out;
}

type LeadInput = { kind: string; number: string; job_id: string | null; created_by: string | null };

/** Everyone in charge of this estimate or quotation: its starter, plus the car's advisors for a job's quotation. */
export async function quoteLeadIds(q: LeadInput): Promise<string[]> {
  const starter = (await startersOf([q.number])).get(q.number) ?? q.created_by;
  const job = q.job_id ? await jobAdvisorIds(q.job_id) : [];
  return Array.from(new Set([...(q.kind === "quotation" ? job : []), starter].filter((x): x is string => !!x)));
}

/** The names of the people in charge, for the list ("Anas"). */
export async function staffNamesOf(ids: string[]): Promise<Map<string, string>> {
  const list = Array.from(new Set(ids.filter(Boolean)));
  if (!list.length) return new Map();
  const { data } = await createAdminClient().from("staff").select("id, display_name").in("id", list);
  return new Map((data ?? []).map((s) => [s.id as string, s.display_name as string]));
}

type QRow = LeadInput & { id: string; version: number; status: string; parent_id: string | null; total_aed: number | string | null; discount_aed: number | string | null; handback_baseline?: Snapshot | null };

async function linesOf(quotationId: string) {
  const { data } = await createAdminClient().from("quotation_lines").select(LINE_SELECT).eq("quotation_id", quotationId).eq("is_active", true).order("position");
  return (data ?? []) as unknown as Parameters<typeof snapshotOf>[0];
}

/** How a version stood before the owner: its parent when the owner made this version, else the kept snapshot. */
async function beforeOf(q: QRow, byId: string): Promise<Snapshot | null> {
  if (q.handback_baseline) return q.handback_baseline;
  if (q.created_by !== byId || !q.parent_id) return null;
  const { data: p } = await createAdminClient().from("quotations").select("id, total_aed, discount_aed").eq("id", q.parent_id).maybeSingle();
  return p ? snapshotOf(await linesOf(p.id as string), p.total_aed as number, p.discount_aed as number, "parent") : null;
}

/**
 * The owner's first change on a quotation in someone else's charge, while it is still being prepared or waits for
 * him: keep how it stood, so the handback can say what changed. A version the owner made himself compares with its
 * parent instead, so nothing is kept for it.
 */
export async function keepBaseline(quotationId: string, staff: { id: string; role_id: string }): Promise<void> {
  if (staff.role_id !== "owner" || !(await handbackReady())) return;
  const admin = createAdminClient();
  const { data } = await admin.from("quotations").select(`id, kind, number, version, job_id, status, created_by, parent_id, total_aed, discount_aed, ${HANDBACK_SELECT}`).eq("id", quotationId).maybeSingle();
  const q = data as unknown as QRow | null;
  if (!q || q.handback_baseline || !["draft", "pending_owner"].includes(q.status)) return;
  if (q.created_by === staff.id && q.parent_id) return;
  const leads = await quoteLeadIds(q);
  if (!leads.some((id) => id !== staff.id)) return;
  await admin.from("quotations").update({ handback_baseline: snapshotOf(await linesOf(q.id), q.total_aed, q.discount_aed, "self") }).eq("id", q.id).is("handback_baseline", null);
}

/**
 * Back to the advisor: the owner approved or edited a quotation in someone else's charge. It reads "Approved by Omar –
 * ready to send" or "Edited by Omar – check and send" with what changed, the advisors in charge are told, and the line
 * sits on their Waiting on you until it is sent. Nothing happens on the owner's own estimates.
 */
export async function handBack(quotationId: string, kind: HandbackKind, by: { id: string; display_name: string }): Promise<string | null> {
  if (!(await handbackReady())) return null;
  const admin = createAdminClient();
  const { data } = await admin.from("quotations").select(`id, kind, number, version, job_id, status, created_by, parent_id, total_aed, discount_aed, ${HANDBACK_SELECT}`).eq("id", quotationId).maybeSingle();
  const q = data as unknown as QRow | null;
  if (!q) return null;
  const leads = (await quoteLeadIds(q)).filter((id) => id !== by.id);
  if (!leads.length) return null;
  const summary = handbackSummary(await beforeOf(q, by.id), afterOf(await linesOf(q.id), q.total_aed, q.discount_aed));
  await admin.from("quotations").update({ handed_back_at: new Date().toISOString(), handed_back_by: by.id, handback_kind: kind, handback_summary: summary, handback_baseline: null, updated_by: by.id }).eq("id", q.id);
  const words = handbackWords(kind, by.display_name);
  await logQuoteEvent(q.id, q.job_id, by.id, "quote_handed_back", `${q.number} v${q.version} ${words}: ${summary}`);
  const label = q.kind === "estimate" ? "ESTIMATE" : "QUOTATION";
  await notifyStaff(leads, { type: "quote_handed_back", title: `${words} · ${label} ${q.number}`, body: summary, jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}/quote/${q.id}` : `/estimates/${q.id}` });
  return summary;
}

export type HandbackLine = { id: string; number: string; version: number; kind: string; jobId: string | null; plate: string; car: string | null; words: string; summary: string; since: string; href: string };

/** The handed-back estimates and quotations waiting for this advisor to check and send (Waiting on you). */
export async function handbacksFor(staff: { id: string; role_id: string }): Promise<HandbackLine[]> {
  if (staff.role_id === "owner" || !(await handbackReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin
    .from("quotations")
    .select(`id, kind, number, version, job_id, status, created_by, ${HANDBACK_SELECT}, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))`)
    .eq("is_active", true)
    .eq("status", "draft")
    .not("handed_back_at", "is", null);
  type R = LeadInput & { id: string; version: number; status: string; handed_back_at: string; handed_back_by: string | null; handback_kind: HandbackKind; handback_summary: string | null; vehicle: Parameters<typeof formatPlate>[0] & { make: { name: string } | null; model: { name: string } | null } | null };
  const rows = ((data ?? []) as unknown as R[]).filter(handbackStands);
  if (!rows.length) return [];
  const starters = await startersOf(rows.map((r) => r.number));
  const names = await staffNamesOf(rows.map((r) => r.handed_back_by ?? ""));
  const out: HandbackLine[] = [];
  for (const r of rows) {
    const mine = starters.get(r.number) === staff.id || (r.kind === "quotation" && r.job_id ? (await jobAdvisorIds(r.job_id)).includes(staff.id) : false);
    if (!mine) continue;
    out.push({
      id: r.id,
      number: r.number,
      version: r.version,
      kind: r.kind,
      jobId: r.job_id,
      plate: r.vehicle ? formatPlate(r.vehicle) : r.number,
      car: r.vehicle ? [r.vehicle.make?.name, r.vehicle.model?.name].filter(Boolean).join(" ") || null : null,
      words: handbackWords(r.handback_kind, names.get(r.handed_back_by ?? "") ?? "the owner"),
      summary: r.handback_summary ?? "",
      since: r.handed_back_at,
      href: r.job_id ? `/jobs/${r.job_id}/quote/${r.id}` : `/estimates/${r.id}`,
    });
  }
  return out;
}

/** The handback on one version while it stands ("Edited by Omar – check and send" + what changed), for its page. */
export async function handbackOf(quotationId: string): Promise<{ words: string; summary: string; at: string; kind: HandbackKind } | null> {
  if (!(await handbackReady())) return null;
  const { data } = await createAdminClient().from("quotations").select(`status, ${HANDBACK_SELECT}`).eq("id", quotationId).maybeSingle();
  const r = data as unknown as { status: string; handed_back_at: string | null; handed_back_by: string | null; handback_kind: HandbackKind | null; handback_summary: string | null } | null;
  if (!r || !handbackStands(r) || !r.handback_kind) return null;
  const name = (await staffNamesOf([r.handed_back_by ?? ""])).get(r.handed_back_by ?? "") ?? "the owner";
  return { words: handbackWords(r.handback_kind, name), summary: r.handback_summary ?? "", at: r.handed_back_at!, kind: r.handback_kind };
}

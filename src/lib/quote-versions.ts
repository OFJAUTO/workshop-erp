import { invoicesForLock, refuseIfLocked } from "./quote-lock-server";
import { liveInvoicesOf } from "./quote-lock";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
import { LINE_SELECT, PART_SELECT, attachBelowCost, loadQuotation, logQuoteEvent, minMarkupFor, parentLineFor, refreshQuoteTotals, toLine, toPart } from "@/lib/quote-data";
import { aed, belowCostOf, partLineChanges, type LineForDiff, blockOf, cheapCostWarning, isHidden, isUnchosen, lineTotal, markupForAddedPart, markupPickWords, sidelessName, type MarkupPick, type PartItem, type QuoteLine, type RevisionPreviewRow } from "@/lib/quotes";
import { newToken } from "@/lib/media";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { belowCostReady, revisionPartsReady, schemaReady } from "@/lib/schema-ready";
import { capsText } from "@/lib/text-case";
import { compactPartNumber } from "@/lib/price-import";
import { flagBelowCost } from "@/lib/below-cost";

export type VersionActor = { id: string; display_name: string };

/** The line fields a new version copies: everything but the id, the quotation, the stamps and the customer's answer. */
export const COPY_FIELDS = (l: QuoteLine) => ({
  package_key: l.package_key ?? null,
  package_items: l.package_items ?? null,
  line_type: l.line_type, positions: l.positions ?? null, title: l.title, details: l.details, group_label: l.group_label, source_type: l.source_type, source_key: l.source_key,
  quantity: l.quantity, unit_cost: l.unit_cost, markup_percent: l.markup_percent, markup_mode: l.markup_mode ?? "percent", markup_aed: l.markup_aed ?? null, unit_price: l.unit_price, hours: l.hours, labour_rate: l.labour_rate, discount_percent: l.discount_percent,
  discount_reason: l.discount_reason, line_total: l.line_total, part_item_id: l.part_item_id, package_id: l.package_id, service_id: l.service_id, visible_to_customer: l.visible_to_customer,
  urgency: l.urgency, advisor_added: l.advisor_added, part_type: l.part_type, brand: l.brand, option_group: l.option_group, chosen: l.chosen, recovery_trips: l.recovery_trips,
  recovery_provider: l.recovery_provider, dangerous: l.dangerous, recovery_provider_kind: l.recovery_provider_kind, markup_confirmed: l.markup_confirmed,
  price_per: l.price_per ?? null, left_off: l.left_off ?? false, outside_work: l.outside_work ?? false, recovery_type: l.recovery_type ?? null, hours_estimate: l.hours_estimate ?? null,
  cut_method: l.cut_method ?? null, cut_note: l.cut_note ?? null,
  side: l.side ?? null,
  film_colour: l.film_colour ?? null, film_code: l.film_code ?? null, tint_percent: l.tint_percent ?? null, recovery_paid_by: l.recovery_paid_by ?? null, recovery_mention_free: l.recovery_mention_free ?? false,
});

const REVISABLE = ["sent", "opened", "expired", "declined", "approved", "pending_owner", "urgent_requested"];

/**
 * The next version of a quotation: every header choice and every line copied (or the urgent lines only), each line
 * remembering the line it came from, with a token of its own. A sent version is marked replaced at once; an approved
 * one stays approved until the customer approves the new version. Priced parts with no line yet are added at the end.
 */
export async function createNextVersion(quotationId: string, by: VersionActor, opts: { urgentOnly?: boolean; reason?: string; /** The caller judges the parts brought up to date (the owner's revision decision): no below-cost notices from here. */ quietBelow?: boolean } = {}): Promise<{ id: string; number: string; version: number; /** Part lines whose cost or quantity moved to the part's own figures, and early charges that joined. */ synced: string[] } | { error: string }> {
  const bundle = await loadQuotation(quotationId);
  if (!bundle) return { error: "Quotation not found." };
  const q = bundle.quotation;
  if (!REVISABLE.includes(q.status)) return { error: "This version cannot be revised." };
  const admin = createAdminClient();
  const urgentOnly = !!opts.urgentOnly;
  // ONE commission per job (21 October): the new version carries the commission WHOLE - who gets it,
  // its approval, even a payment already made - and the old version keeps only a tombstone below.
  const { data: com } = await admin
    .from("quotations")
    .select("commission_to, commission_kind, commission_value, commission_aed, commission_status, commission_set_by, commission_set_at, commission_decided_by, commission_decided_at, commission_decision_note, commission_paid_at, commission_paid_by, commission_paid_method, commission_paid_note")
    .eq("id", q.id)
    .maybeSingle();
  const carried = com?.commission_to ? { ...com, commission_status: com.commission_status ?? "approved" } : {};
  const { data: created, error } = await admin
    .from("quotations")
    .insert({ kind: q.kind, number: q.number, version: q.version + 1, parent_id: q.id, token: newToken(), job_id: q.job_id, customer_id: q.customer_id, vehicle_id: q.vehicle_id, estimate_id: q.estimate_id, additional_to_id: q.additional_to_id ?? null, discount_percent: q.discount_percent, vat_percent: q.vat_percent, promised_at: q.promised_at, validity_days: q.validity_days, customer_note: q.customer_note, payment_by_card: q.payment_by_card, not_quoted: q.not_quoted ?? {}, discount_kind: q.discount_kind ?? null, discount_value: q.discount_value ?? null, discount_scope: q.discount_scope ?? "labour", discount_set_by: q.discount_set_by ?? null, discount_set_at: q.discount_set_at ?? null, expected_payment_method: q.expected_payment_method ?? "not_sure", materials_cost_aed: q.materials_cost_aed ?? null, tint_spec: q.tint_spec ?? null, ...carried, created_by: by.id, updated_by: by.id })
    .select("id")
    .single();
  if (error || !created) return { error: error?.message ?? "Could not revise." };
  if (com?.commission_to) {
    await admin
      .from("quotations")
      .update({ commission_to: null, commission_kind: null, commission_value: null, commission_aed: 0, commission_status: "superseded", commission_decided_by: null, commission_decided_at: null, commission_decision_note: null, commission_paid_at: null, commission_paid_by: null, commission_paid_method: null, commission_paid_note: null, updated_by: by.id })
      .eq("id", q.id);
    await logQuoteEvent(q.id, q.job_id, by.id, "commission_carried", `${q.number}: the commission for ${com.commission_to} moved to version ${q.version + 1} - one commission per job, never a new one`);
  }
  // Urgent only: the labour lines marked Urgent, their parts, and every other charge. The rest is kept against the car as declined work.
  const active = bundle.lines.filter((l) => l.is_active && !l.fee_kind);
  const keepLabour = active.filter((l) => blockOf(l) === "labour" && (!urgentOnly || l.urgency === "urgent"));
  const keepIds = new Set(keepLabour.map((l) => l.id));
  const kept = active.filter((l) => blockOf(l) === "other" || keepIds.has(l.id) || (blockOf(l) === "parts" && (!l.parent_line_id || keepIds.has(l.parent_line_id))));
  const keptIds = new Set(kept.map((l) => l.id));
  const left = active.filter((l) => !keptIds.has(l.id) && !isHidden(l));
  const idMap = new Map<string, string>();
  // The owner's approval of a line below its cost travels with the line (it covers the same figures only).
  const stampReady = await belowCostReady();
  const stampOf = (l: QuoteLine) => (stampReady && l.below_cost_at ? { below_cost_reason: l.below_cost_reason ?? null, below_cost_by: l.below_cost_by ?? null, below_cost_at: l.below_cost_at, below_cost_sell_aed: l.below_cost_sell_aed ?? null, below_cost_cost_aed: l.below_cost_cost_aed ?? null } : {});
  for (const l of kept.filter((x) => !x.parent_line_id)) {
    const { data: ins } = await admin.from("quotation_lines").insert({ quotation_id: created.id, position: l.position, ...COPY_FIELDS(l), ...stampOf(l), revised_from_line_id: l.id, parent_line_id: null, created_by: by.id, updated_by: by.id }).select("id").single();
    if (ins) idMap.set(l.id, ins.id);
  }
  for (const l of kept.filter((x) => x.parent_line_id)) {
    await admin.from("quotation_lines").insert({ quotation_id: created.id, position: l.position, ...COPY_FIELDS(l), ...stampOf(l), revised_from_line_id: l.id, parent_line_id: idMap.get(l.parent_line_id!) ?? null, created_by: by.id, updated_by: by.id });
  }
  if (left.length && q.kind === "quotation") {
    await admin.from("declined_work").insert(left.map((l) => ({ vehicle_id: q.vehicle_id, customer_id: q.customer_id, job_id: q.job_id, quotation_id: q.id, title: l.title, details: `${l.group_label ?? ""}${l.group_label ? " · " : ""}left out of the urgent-only quotation`, amount_aed: l.line_total, declined_at: new Date().toISOString(), created_by: by.id, updated_by: by.id })));
  }
  if (["sent", "opened", "expired", "pending_owner", "urgent_requested"].includes(q.status)) await admin.from("quotations").update({ status: "superseded", updated_by: by.id }).eq("id", q.id);
  // 2 November 2026: the copied part lines carry the APPROVED version's figures; a part Parts changed while the
  // quotation was approved (its cost, quantity, type, brand, side) is brought to its own figures on the new version -
  // never the old cost - and a part taken off leaves it. Then every priced part with no line yet joins (Our stock
  // included), and the early charges that waited for this revision go on.
  let synced: string[] = [];
  if (q.job_id && q.kind === "quotation") {
    synced = await syncChangedParts(q.job_id, created.id, by.id);
    await syncMissingParts(q.job_id, created.id, by.id);
    const { pushWaitingCharges } = await import("./charges");
    synced = [...synced, ...(await pushWaitingCharges(q.job_id, created.id, by))];
  }
  await refreshQuoteTotals(created.id, await getSettings(), by.id);
  await logQuoteEvent(created.id, q.job_id, by.id, urgentOnly ? "quote_urgent_version" : "quote_revised", `${q.number} version ${q.version + 1} started by ${by.display_name}${opts.reason ? ` (${opts.reason})` : ""}${urgentOnly ? ` with the urgent work only (${kept.length} line${kept.length === 1 ? "" : "s"}; ${left.length} left out and kept as declined work)` : ""}`);
  // A new cost that sells a line below cost is written down and stops the send (the owner's decision judges its own).
  if (synced.length && !opts.quietBelow) await flagBelowCost(created.id, synced, by.id, "a part's cost or an early charge changed while the quotation was approved");
  return { id: created.id, number: q.number, version: q.version + 1, synced };
}


/**
 * The part lines of a (new) version brought to their parts' own figures: every line whose part changed in money or in
 * what the customer sees, or was taken off, goes through syncPartLine (no below-cost notices here: the caller decides).
 * Returns the lines whose cost or quantity moved.
 */
export async function syncChangedParts(jobId: string, quotationId: string, by: string | null): Promise<string[]> {
  const admin = createAdminClient();
  const { data: lineRows } = await admin.from("quotation_lines").select("id, part_item_id, unit_cost, quantity, part_type, brand, positions").eq("quotation_id", quotationId).eq("is_active", true).not("part_item_id", "is", null);
  const rows = (lineRows ?? []) as (LineForDiff & { id: string; part_item_id: string })[];
  if (!rows.length) return [];
  const { data: partRows } = await admin.from("part_items").select(PART_SELECT).in("id", rows.map((r) => r.part_item_id));
  const parts = new Map(((partRows ?? []) as Record<string, unknown>[]).map((r) => { const p = toPart(r); return [p.id, p] as const; }));
  const moved: string[] = [];
  for (const l of rows) {
    const p = parts.get(l.part_item_id);
    if (!p) continue;
    const d = partLineChanges(l, p);
    if (!d.gone && !d.money && !d.words.length) continue;
    await syncPartLine(jobId, p.id, by, quotationId, { quietBelow: true });
    if (!d.gone && d.money) moved.push(l.id);
  }
  return moved;
}

/**
 * The parts behind a revision request from Parts, when it names them: all taken off since = nothing left to revise.
 * Null when the request names no parts (an early charge, an advisor's request, one from before the list existed).
 */
export async function requestPartsGone(quotationId: string): Promise<{ allGone: boolean; words: string } | null> {
  if (!(await revisionPartsReady())) return null;
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("revision_request_kind, revision_request_parts").eq("id", quotationId).maybeSingle();
  const ids = ((q?.revision_request_parts as string[] | null) ?? []);
  if (q?.revision_request_kind !== "parts" || !ids.length) return null;
  const { data: parts } = await admin.from("part_items").select(`id, description, is_active, confirm_status, removed_at, removed_reason, not_needed_at${(await schemaReady("part_items", "refused_at")) ? ", refused_at" : ""}`).in("id", ids);
  const rows = (parts ?? []) as unknown as { id: string; description: string; is_active: boolean; confirm_status: string; removed_at: string | null; removed_reason: string | null; not_needed_at: string | null; refused_at?: string | null }[];
  const allGone = rows.length >= ids.length && rows.every(partGone);
  return { allGone, words: rows.map((p) => `${String(p.description).toUpperCase()}${p.removed_reason ? ` (${p.removed_reason})` : ""}`).join(", ") };
}

/** The request's part list cleared with its answer (allowed, declined, used), once the column exists. */
export async function requestPartsCleared(): Promise<{ revision_request_parts?: null }> {
  return (await revisionPartsReady()) ? { revision_request_parts: null } : {};
}

/**
 * Where a part change lands on the job's quotation: the open draft when there is one; otherwise the next version is
 * started from the latest sent or approved one, and the advisor is told to send it. Parts never think about versions.
 */
export async function quoteTargetFor(jobId: string, by: string | null, change?: string, ask: { partIds?: string[]; redOf?: () => Promise<string | null> } = {}): Promise<{ id: string; created: boolean } | null> {
  const admin = createAdminClient();
  const { data: latest } = await admin.from("quotations").select("id, number, version, status, job_id, created_by, sent_by, revision_allowed_at, revision_requested_at, revision_declined_at").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).neq("status", "cancelled").order("version", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return null;
  // Several quotations prepared at once (estimates carried over at gate-in, 30 October 2026): the parts go to the
  // ORIGINAL first - the oldest number whose newest version is still being prepared.
  {
    const { data: rows } = await admin.from("quotations").select("id, number, version, status, created_at").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).neq("status", "cancelled").order("created_at");
    const firstSeen = new Map<string, string>();
    const newest = new Map<string, { id: string; version: number; status: string }>();
    for (const r of rows ?? []) {
      if (!firstSeen.has(r.number)) firstSeen.set(r.number, r.created_at as string);
      const cur = newest.get(r.number);
      if (!cur || Number(r.version) > cur.version) newest.set(r.number, { id: r.id as string, version: Number(r.version), status: r.status as string });
    }
    const preparing = Array.from(newest.entries())
      .filter(([, v]) => v.status === "draft" || v.status === "pending_owner")
      .sort(([a], [b]) => ((firstSeen.get(a) ?? "") < (firstSeen.get(b) ?? "") ? -1 : 1));
    if (preparing.length) return { id: preparing[0][1].id, created: false };
  }
  if (latest.status === "draft" || latest.status === "pending_owner") return { id: latest.id, created: false };
  if (!REVISABLE.includes(latest.status)) return null;
  const { data: who } = by ? await admin.from("staff").select("display_name").eq("id", by).maybeSingle() : { data: null };
  // A tax invoice is out: the quotation cannot change any more. The owner hears what Parts changed; a credit note or a new invoice settles it.
  if (latest.status === "approved") {
    const live = liveInvoicesOf(await invoicesForLock(jobId));
    if (live.tax) {
      await refuseIfLocked(latest.id, by, change ?? "change the parts", "Parts desk");
      const { data: jobRow } = await admin.from("jobs").select("job_number").eq("id", jobId).maybeSingle();
      await notifyRoles(["owner"], { type: "revision_request", title: `${change ?? "Parts changed"} · ${jobRow?.job_number ?? ""}: tax invoice ${live.tax.number} already issued`, body: `${latest.number} is locked once a tax invoice is out. Settle the difference with a credit note or a new invoice.`, jobId, href: `/jobs/${jobId}/invoice` });
      return null;
    }
  }
  // The customer approved this quotation: a change from Parts needs the owner's one-time permission first; the owner is asked, the part waits.
  if (latest.status === "approved" && !latest.revision_allowed_at) {
    await askOwnerForRevision({ id: latest.id, number: latest.number, job_id: jobId, pending: !!latest.revision_requested_at && !latest.revision_declined_at }, by, who?.display_name ?? "Parts", change ?? "Parts changed the priced parts", "parts", ask);
    return null;
  }
  const r = await createNextVersion(latest.id, { id: by ?? latest.created_by ?? "", display_name: who?.display_name ?? "Parts" }, { reason: latest.status === "approved" ? "parts changed, allowed by the owner" : "parts changed" });
  if ("error" in r) return null;
  // The permission covers one revision.
  if (latest.status === "approved") await admin.from("quotations").update({ revision_allowed_at: null, revision_allowed_by: null, ...(await requestPartsCleared()), updated_by: by }).eq("id", latest.id);
  const { data: job } = await admin.from("jobs").select("job_number, gated_in_by").eq("id", jobId).maybeSingle();
  const ids = Array.from(new Set([job?.gated_in_by, latest.created_by, latest.sent_by].filter((x): x is string => !!x)));
  await notifyStaff(ids, { type: "quote_revised_by_parts", title: `Parts changed on ${job?.job_number ?? ""}: send the revised quotation`, body: `${latest.number} version ${r.version} is ready with the change from Parts. Check it and send it to the customer.`, jobId, href: `/jobs/${jobId}/quote/${r.id}?send=1` });
  return { id: r.id, created: true };
}

/**
 * A revision of an approved quotation is asked of the owner (the advisor's reason, or what Parts changed). One open
 * request at a time: a second change while the first waits adds nothing. The owner answers on the quotation page.
 */
export async function askOwnerForRevision(q: { id: string; number: string; job_id: string | null; pending: boolean }, by: string | null, byName: string, reason: string, kind: "advisor" | "parts" = "parts", ask: { partIds?: string[]; redOf?: () => Promise<string | null> } = {}) {
  const opts = { partIds: ask.partIds, red: null as string | null };
  const admin = createAdminClient();
  const listReady = await revisionPartsReady();
  if (q.pending) {
    // One open request at a time; a later part from Parts joins the list behind a waiting PARTS request that already
    // names its parts (so it is withdrawn only when all are gone). An advisor's request, or one that names no parts (an
    // early charge), never takes a part list: it is never withdrawn by Parts taking a part off.
    if (listReady && kind === "parts" && opts.partIds?.length) {
      const { data: cur } = await admin.from("quotations").select("revision_request_kind, revision_request_parts").eq("id", q.id).maybeSingle();
      const have = (cur?.revision_request_parts as string[] | null) ?? null;
      const more = have && cur?.revision_request_kind === "parts" ? opts.partIds.filter((x) => !have.includes(x)) : [];
      if (have && more.length) await admin.from("quotations").update({ revision_request_parts: [...have, ...more] }).eq("id", q.id);
    }
    return;
  }
  opts.red = ask.redOf ? await ask.redOf() : null;
  // A new request writes its own part list every time (none for an advisor's request or an early charge), so a list
  // left from an earlier answered request never stays behind it.
  const list = listReady ? { revision_request_parts: kind === "parts" && opts.partIds?.length ? opts.partIds : null } : {};
  await admin.from("quotations").update({ revision_requested_at: new Date().toISOString(), revision_requested_by: by, revision_request_reason: reason.slice(0, 300), revision_request_kind: kind, revision_allowed_at: null, revision_allowed_by: null, revision_declined_at: null, revision_declined_by: null, revision_decision_note: null, ...list, updated_by: by }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, by, "revision_requested", `${q.number}: ${byName} asks to revise the approved quotation: ${reason}${opts.red ? ` · CHECK: ${opts.red}` : ""}`);
  const { data: job } = q.job_id ? await admin.from("jobs").select("job_number").eq("id", q.job_id).maybeSingle() : { data: null };
  await notifyRoles(["owner"], { type: "revision_request", title: kind === "parts" ? `${opts.red ? "CHECK THE PRICE · " : ""}${reason}: allow revised quote?` : `Allow a revised quotation? ${q.number}${job ? ` · ${job.job_number}` : ""}`, body: kind === "parts" ? `${opts.red ? `${opts.red}. ` : ""}${q.number} was approved by the customer. Allow one revision, or decline.` : `${byName}: ${reason}`, jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}/quote/${q.id}?revise=1` : `/estimates/${q.id}` });
}

/** A part that is gone (taken off, not needed, refused, rejected). */
const partGone = (p: { is_active?: boolean | null; confirm_status?: string | null; removed_at?: string | null; not_needed_at?: string | null; refused_at?: string | null }) => p.is_active === false || p.confirm_status === "rejected" || !!p.removed_at || !!p.not_needed_at || !!p.refused_at;

/**
 * A pending revision request FROM PARTS whose parts are ALL gone since (Parts removed the part as a duplicate) is
 * withdrawn by itself: nothing is left to revise, the owner's bell is marked read, the quotation's history says why.
 * Never an advisor's request (its reason is his own), never one that names no parts, never on a version already
 * replaced by a newer one.
 */
export async function withdrawStaleRevisions(jobId: string, by: string | null): Promise<number> {
  if (!(await revisionPartsReady())) return 0;
  const admin = createAdminClient();
  const { data: qs } = await admin.from("quotations").select("id, number, job_id, revision_request_parts").eq("job_id", jobId).eq("is_active", true).eq("status", "approved").eq("revision_request_kind", "parts").not("revision_requested_at", "is", null).is("revision_allowed_at", null).is("revision_declined_at", null);
  let n = 0;
  for (const q of (qs ?? []) as { id: string; number: string; job_id: string | null; revision_request_parts: string[] | null }[]) {
    const ids = q.revision_request_parts ?? [];
    if (!ids.length) continue;
    const { data: newer } = await admin.from("quotations").select("id").eq("parent_id", q.id).limit(1);
    if ((newer ?? []).length) continue;
    const { data: parts } = await admin.from("part_items").select(`id, description, is_active, confirm_status, removed_at, removed_reason, not_needed_at${(await schemaReady("part_items", "refused_at")) ? ", refused_at" : ""}`).in("id", ids);
    const rows = (parts ?? []) as unknown as { id: string; description: string; is_active: boolean; confirm_status: string; removed_at: string | null; removed_reason: string | null; not_needed_at: string | null; refused_at?: string | null }[];
    if (rows.length < ids.length || !rows.every(partGone)) continue;
    const words = rows.map((p) => `${String(p.description).toUpperCase()}${p.removed_reason ? ` (${p.removed_reason})` : ""}`).join(", ");
    const note = `Withdrawn by itself: ${words} ${rows.length === 1 ? "was" : "were"} taken off by Parts, nothing left to revise.`;
    const { data: done } = await admin.from("quotations").update({ revision_declined_at: new Date().toISOString(), revision_declined_by: by, revision_decision_note: note, updated_by: by }).eq("id", q.id).is("revision_allowed_at", null).is("revision_declined_at", null).select("id");
    if (!(done ?? []).length) continue;
    await logQuoteEvent(q.id, q.job_id, by, "revision_withdrawn", `${q.number}: the revision request is withdrawn. ${note}`);
    await admin.from("notifications").update({ read_at: new Date().toISOString() }).eq("type", "revision_request").is("read_at", null).like("href", `%/quote/${q.id}%`);
    n++;
  }
  return n;
}

/** The job's other parts and the last price for a part number: what a part's cost is compared with (the twin, the memory). */
async function costReferences(jobId: string, p: Pick<PartItem, "id" | "description" | "part_number">): Promise<{ label: string; cost: number | null }[]> {
  const admin = createAdminClient();
  const pn = compactPartNumber(p.part_number);
  const name = sidelessName(p.description);
  const { data: mates } = await admin.from("part_items").select("id, description, part_number, cost_aed, removed_at, confirm_status").eq("job_id", jobId).eq("is_active", true).neq("id", p.id).not("cost_aed", "is", null);
  const refs: { label: string; cost: number | null }[] = [];
  for (const m of (mates ?? []) as { id: string; description: string; part_number: string | null; cost_aed: number | string | null; removed_at: string | null; confirm_status: string }[]) {
    if (m.removed_at || m.confirm_status === "rejected") continue;
    if ((pn.length >= 4 && compactPartNumber(m.part_number) === pn) || (name && sidelessName(m.description) === name)) refs.push({ label: `${String(m.description).toUpperCase()} on this job`, cost: Number(m.cost_aed) });
  }
  if (pn.length >= 4) {
    // The last price given for the same number on another job (the price memory's rule).
    const { data: hist } = await admin.from("part_items").select("part_number, cost_aed, priced_at, job_id, job:jobs!part_items_job_id_fkey(job_number)").eq("is_active", true).neq("job_id", jobId).not("priced_at", "is", null).not("cost_aed", "is", null).not("part_number", "is", null).order("priced_at", { ascending: false }).limit(400);
    const hit = ((hist ?? []) as unknown as { part_number: string | null; cost_aed: number | string | null; job: { job_number: string } | null }[]).find((r) => compactPartNumber(r.part_number) === pn);
    if (hit) refs.push({ label: `the last price for ${p.part_number}${hit.job?.job_number ? ` (${hit.job.job_number})` : ""}`, cost: Number(hit.cost_aed) });
  }
  return refs;
}

/** The markup a part takes when it joins a revised quotation (the quotation's own, never silently the bare minimum). */
async function addedPartMarkup(quotationId: string, p: Pick<PartItem, "id" | "description" | "part_number" | "cost_aed">, minMarkup: number): Promise<MarkupPick> {
  const admin = createAdminClient();
  const { data: rows } = await admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", quotationId).eq("is_active", true).eq("line_type", "part");
  const lines = ((rows ?? []) as Record<string, unknown>[]).map(toLine).filter((l) => !isUnchosen(l) && l.part_item_id !== p.id);
  const ids = lines.map((l) => l.part_item_id).filter((x): x is string => !!x);
  const { data: nums } = ids.length ? await admin.from("part_items").select("id, part_number").in("id", ids) : { data: [] as { id: string; part_number: string | null }[] };
  const pnOf = new Map((nums ?? []).map((r) => [r.id as string, compactPartNumber(r.part_number as string | null)]));
  return markupForAddedPart(lines.map((l) => ({ title: l.title, partNumber: l.part_item_id ? (pnOf.get(l.part_item_id) ?? null) : null, unit_cost: l.unit_cost, markup_mode: l.markup_mode ?? "percent", markup_percent: l.markup_percent, markup_aed: l.markup_aed ?? null })), { title: p.description, partNumber: compactPartNumber(p.part_number), cost: p.cost_aed }, minMarkup);
}

/** "cost AED 5,502.73 (list 12,228.30 less 55%)": the cost always labelled, with where it came from. */
function costWords(p: Pick<PartItem, "cost_aed" | "list_price_aed" | "discount_percent">): string {
  if (p.cost_aed === null || p.cost_aed === undefined) return "no price yet";
  const disc = Number(p.discount_percent) || 0;
  const list = p.list_price_aed === null || p.list_price_aed === undefined ? null : Number(p.list_price_aed);
  return `cost ${aed(Number(p.cost_aed))}${list !== null && disc > 0 ? ` (list ${aed(list)} less ${disc}%)` : ""}`;
}

/**
 * What allowing the revision would put on the new version, part by part (the owner's box and his decision): a part
 * Parts added (at the markup it would get), a part whose cost or quantity changed (at the line's own markup), a part
 * gone. Each with the list, discount, cost and selling price, red when it would sell below cost or its cost is under
 * half of the same part elsewhere.
 */
export async function revisionPreview(quotationId: string): Promise<RevisionPreviewRow[]> {
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select("id, job_id, kind, vehicle_id").eq("id", quotationId).maybeSingle();
  if (!q?.job_id || q.kind !== "quotation") return [];
  const jobId = q.job_id as string;
  const settings = await getSettings();
  const { data: v } = await admin.from("jobs").select("vehicle:vehicles(make:vehicle_makes(name))").eq("id", jobId).maybeSingle();
  const make = ((v?.vehicle as unknown as { make: { name: string } | null } | null)?.make?.name) ?? null;
  const minMarkup = minMarkupFor(settings, make);
  const [{ data: lineRows }, { data: partRows }] = await Promise.all([
    admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", quotationId).eq("is_active", true).eq("line_type", "part"),
    admin.from("part_items").select(`${PART_SELECT}, not_needed_at${(await schemaReady("part_items", "refused_at")) ? ", refused_at" : ""}`).eq("job_id", jobId),
  ]);
  const lines = await attachBelowCost(((lineRows ?? []) as Record<string, unknown>[]).map(toLine));
  const parts = new Map(((partRows ?? []) as unknown as Record<string, unknown>[]).map((r) => [String(r.id), { ...toPart(r), not_needed_at: (r.not_needed_at as string | null) ?? null, refused_at: (r.refused_at as string | null | undefined) ?? null }]));
  const rows: RevisionPreviewRow[] = [];
  const base = (p: PartItem, kind: RevisionPreviewRow["kind"]) => ({ partId: p.id, kind, title: String((p.customer_name ?? "").trim() || p.description).toUpperCase(), supplier: p.supplier ?? null, list: p.list_price_aed === null || p.list_price_aed === undefined ? null : Number(p.list_price_aed), discount: p.discount_percent === null || p.discount_percent === undefined ? null : Number(p.discount_percent), cost: p.cost_aed === null ? null : Number(p.cost_aed), qty: Number(p.confirmed_quantity ?? p.quantity) || 1 });
  for (const m of await missingPricedParts(jobId, quotationId)) {
    const p = parts.get(m.id);
    if (!p) continue;
    const pick = await addedPartMarkup(quotationId, p, minMarkup);
    const projected = { line_type: "part" as const, title: p.description, quantity: Number(p.confirmed_quantity ?? p.quantity) || 1, unit_cost: p.cost_aed, markup_percent: pick.markup_percent, markup_mode: pick.markup_mode, markup_aed: pick.markup_aed, unit_price: null, hours: null, labour_rate: null, discount_percent: 0, visible_to_customer: true };
    rows.push({ ...base(p, "added"), oldCost: null, sell: lineTotal(projected), markupWords: markupPickWords(pick), below: belowCostOf(projected), cheap: cheapCostWarning(p.cost_aed, await costReferences(jobId, p)) });
  }
  for (const l of lines) {
    const p = l.part_item_id ? parts.get(l.part_item_id) : undefined;
    if (!p) continue;
    // The same answer the new version follows (syncChangedParts): taken off, the money, what the customer sees.
    const d = partLineChanges(l, p);
    // Taken off = what the new version really drops (syncPartLine retires a line whose part is inactive or rejected).
    if (d.gone) {
      rows.push({ ...base(p, "removed"), oldCost: l.unit_cost, sell: null, markupWords: null, below: null, cheap: null });
      continue;
    }
    if (!d.money && !d.words.length) continue;
    const qty = Number(p.confirmed_quantity ?? p.quantity) || 1;
    const costNow = p.cost_aed === null ? null : Number(p.cost_aed);
    const projected = { ...l, unit_cost: costNow, quantity: qty };
    rows.push({ ...base(p, "changed"), changes: d.words, oldCost: l.unit_cost, sell: lineTotal(projected), markupWords: l.markup_mode === "aed" ? `AED ${l.markup_aed ?? 0} each (as quoted)` : `${Math.round((l.markup_percent ?? 0) * 100) / 100}% (as quoted)`, below: belowCostOf(projected), cheap: d.money ? cheapCostWarning(costNow, await costReferences(jobId, p)) : null });
  }
  // Early charges added after the approval wait for this revision too: they join the new version as they were typed.
  const { chargesWaitingForRevision, chargeQuoteLine } = await import("./charges");
  for (const c of await chargesWaitingForRevision(jobId)) {
    const projected = { ...(chargeQuoteLine(c) as unknown as QuoteLine), is_active: true, discount_percent: 0, visible_to_customer: true, hours: null, labour_rate: null };
    rows.push({ partId: c.id, kind: "charge", title: String(c.description ?? "").toUpperCase(), supplier: c.provider ?? null, list: null, discount: null, cost: Number(c.cost_aed) || 0, oldCost: null, qty: Number(projected.quantity) || 1, sell: lineTotal(projected), markupWords: c.free ? "complimentary" : null, below: belowCostOf(projected), cheap: null });
  }
  return rows;
}

/** The priced parts of a job (Our stock included) with no line on the given quotation. */
export async function missingPricedParts(jobId: string, quotationId: string): Promise<{ id: string; description: string }[]> {
  const admin = createAdminClient();
  // 30 October 2026: a job can carry several quotations (an additional one, estimates carried over at gate-in). A part
  // already on the newest version of ANOTHER quotation number of the job has its home: it is not missing from this one.
  const { data: qs } = await admin.from("quotations").select("id, number, version").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).neq("status", "cancelled");
  const me = (qs ?? []).find((x) => x.id === quotationId);
  const newest = new Map<string, { id: string; version: number }>();
  for (const x of qs ?? []) {
    const cur = newest.get(x.number as string);
    if (!cur || Number(x.version) > cur.version) newest.set(x.number as string, { id: x.id as string, version: Number(x.version) });
  }
  const others = Array.from(newest.entries()).filter(([n]) => n !== me?.number).map(([, v]) => v.id);
  const [{ data: parts }, { data: lines }] = await Promise.all([
    admin.from("part_items").select(`id, description, cost_aed, confirm_status, is_active, removed_at, not_needed_at, replaced_part_id${(await schemaReady("part_items", "refused_at")) ? ", refused_at" : ""}`).eq("job_id", jobId).eq("is_active", true).not("cost_aed", "is", null),
    admin.from("quotation_lines").select("part_item_id").in("quotation_id", [quotationId, ...others]).eq("is_active", true).not("part_item_id", "is", null),
  ]);
  const have = new Set((lines ?? []).map((l) => String(l.part_item_id)));
  type P = { id: string; description: string; confirm_status: string; removed_at: string | null; not_needed_at: string | null; replaced_part_id: string | null; refused_at?: string | null };
  // A refused part never comes back; a replacement (another supplier for a part the customer approved) is covered by
  // the line of the part it replaces (1 November 2026, LPO-00038).
  return ((parts ?? []) as unknown as P[]).filter((p) => p.confirm_status !== "rejected" && !p.removed_at && !p.not_needed_at && !p.refused_at && !have.has(p.id) && !(p.replaced_part_id && have.has(p.replaced_part_id))).map((p) => ({ id: p.id, description: p.description }));
}

/** Adds the missing priced parts to the quotation, one line each. */
export async function syncMissingParts(jobId: string, quotationId: string, by: string | null): Promise<number> {
  const missing = await missingPricedParts(jobId, quotationId);
  for (const m of missing) await syncPartLine(jobId, m.id, by, quotationId);
  return missing.length;
}

/**
 * The part's line on the quotation: made when the part is priced, kept in step afterwards, retired when the part goes.
 * With no quotation given, the change lands on the open draft or on a new version (see quoteTargetFor).
 */
export async function syncPartLine(jobId: string, partId: string, by: string | null, quotationId?: string, opts: { /** A new version brought up to date: the caller judges below cost itself. */ quietBelow?: boolean } = {}): Promise<{ quotationId: string | null; created: boolean; change: "added" | "changed" | "removed" | null }> {
  const admin = createAdminClient();
  // A version named outright must still be open: an approved or replaced one refuses (and the attempt is written down).
  if (quotationId) {
    const refused = await refuseIfLocked(quotationId, by, "change a part line", "Parts desk");
    if (refused) return { quotationId, created: false, change: null };
  }
  // What changed, in words, in case the owner has to be asked (the quotation was approved by the customer). The figure
  // is always labelled - "cost AED 5,502.73 (list 12,228.30 less 55%)" - never a bare amount that reads like a price
  // (2 November 2026, Q-00039).
  let changeWords: string | undefined;
  let redOf: (() => Promise<string | null>) | undefined;
  if (!quotationId) {
    const [{ data: p0raw }, { data: who0 }, { data: onQuote }] = await Promise.all([
      admin.from("part_items").select(`${PART_SELECT}, not_needed_at${(await schemaReady("part_items", "refused_at")) ? ", refused_at" : ""}`).eq("id", partId).maybeSingle(),
      by ? admin.from("staff").select("display_name").eq("id", by).maybeSingle() : Promise.resolve({ data: null }),
      admin.from("quotation_lines").select("id").eq("part_item_id", partId).eq("is_active", true).limit(1),
    ]);
    const r0 = p0raw as unknown as Record<string, unknown> | null;
    const p0 = r0 ? { ...toPart(r0), not_needed_at: (r0.not_needed_at as string | null) ?? null, refused_at: (r0.refused_at as string | null | undefined) ?? null } : null;
    const onAQuote = (onQuote ?? []).length > 0;
    // A part that is gone and on no quotation changes nothing: no new version, no question for the owner - and a
    // revision request it was waiting on is withdrawn when nothing is left behind it.
    if (p0 && partGone(p0) && !onAQuote) {
      await withdrawStaleRevisions(jobId, by);
      return { quotationId: null, created: false, change: null };
    }
    if (p0) {
      const verb = partGone(p0) ? "removed" : onAQuote ? "changed" : "added";
      changeWords = `${who0?.display_name ?? "Parts"} ${verb} ${String(p0.description).toUpperCase()}${verb === "removed" ? "" : ` – ${costWords(p0)}`}`;
      if (verb !== "removed") redOf = async () => cheapCostWarning(p0.cost_aed, await costReferences(jobId, p0));
    }
  }
  // A part already on a quotation still being prepared (several on one job: estimates carried over at gate-in) stays
  // on that one; it never jumps to another quotation as a second line.
  let home: string | null = null;
  if (!quotationId) {
    const { data: onLines } = await admin.from("quotation_lines").select("quotation_id").eq("part_item_id", partId).eq("is_active", true);
    const ids = Array.from(new Set((onLines ?? []).map((x) => x.quotation_id as string)));
    if (ids.length) {
      const { data: open } = await admin.from("quotations").select("id").in("id", ids).eq("job_id", jobId).eq("kind", "quotation").in("status", ["draft", "pending_owner"]).limit(1).maybeSingle();
      home = (open?.id as string | undefined) ?? null;
    }
  }
  const target = quotationId ? { id: quotationId, created: false } : home ? { id: home, created: false } : await quoteTargetFor(jobId, by, changeWords, { partIds: [partId], redOf });
  if (!target) return { quotationId: null, created: false, change: null };
  const qid = target.id;
  const [{ data: pRaw }, { data: line }] = await Promise.all([
    admin.from("part_items").select(PART_SELECT).eq("id", partId).maybeSingle(),
    admin.from("quotation_lines").select("id").eq("quotation_id", qid).eq("part_item_id", partId).eq("is_active", true).maybeSingle(),
  ]);
  if (!pRaw) return { quotationId: qid, created: target.created, change: null };
  const p = toPart(pRaw as Record<string, unknown>);
  // The customer name when the advisor set one, else the supplier name; part numbers never reach a customer document.
  // Saved in capitals (1 November 2026, B1): the same words on the screen, the PDF and the customer's page.
  const title = capsText((p.customer_name ?? "").trim() || p.description);
  const qty = Number(p.confirmed_quantity ?? p.quantity) || 1;
  const shared = { title, quantity: p.confirmed_quantity ?? p.quantity, unit_cost: p.cost_aed, part_type: p.part_type, brand: p.brand, option_group: p.option_group, positions: p.positions ?? null, updated_by: by };
  let change: "added" | "changed" | "removed" | null = null;
  let markupNote = "";
  if (p.confirm_status === "rejected" || !p.is_active) {
    if (line) {
      await admin.from("quotation_lines").update({ is_active: false, updated_by: by }).eq("id", line.id);
      change = "removed";
    }
  } else if (line) {
    const { data: before } = await admin.from("quotation_lines").select("unit_cost, quantity").eq("id", line.id).maybeSingle();
    await admin.from("quotation_lines").update(shared).eq("id", line.id);
    // A new cost can put the line below its cost (an owner's discount, a low AED markup): written down, the people in
    // charge told, and "Before sending" stops it (2 November 2026).
    if (!opts.quietBelow && before && (Number(before.unit_cost ?? -1) !== Number(p.cost_aed ?? -1) || Number(before.quantity) !== Number(shared.quantity))) await flagBelowCost(qid, [line.id], by, `Parts changed the cost to ${p.cost_aed === null ? "nothing" : aed(Number(p.cost_aed))}`);
    const { data: cur } = await admin.from("quotation_lines").select("parent_line_id").eq("id", line.id).maybeSingle();
    if (cur && !cur.parent_line_id) {
      const { data: req0 } = p.part_request_id ? await admin.from("part_requests").select("source_type, source_key").eq("id", p.part_request_id).maybeSingle() : { data: null };
      const parent = await parentLineFor(qid, req0 ? { source_type: req0.source_type, source_key: req0.source_key } : null);
      if (parent) await admin.from("quotation_lines").update({ parent_line_id: parent, updated_by: by }).eq("id", line.id);
    }
    change = "changed";
  } else {
    const settings = await getSettings();
    const { data: v } = await admin.from("jobs").select("vehicle:vehicles(make:vehicle_makes(name))").eq("id", jobId).maybeSingle();
    const make = ((v?.vehicle as unknown as { make: { name: string } | null } | null)?.make?.name) ?? null;
    // On a revised quotation (version 2 on) a part added by Parts takes the quotation's own markup - the matching
    // part's, else the one used most - never silently the bare minimum (2 November 2026: the twin head light).
    const { data: tq } = await admin.from("quotations").select("version").eq("id", qid).maybeSingle();
    const pick: MarkupPick = Number(tq?.version) > 1 ? await addedPartMarkup(qid, p, minMarkupFor(settings, make)) : { markup_mode: "percent", markup_percent: minMarkupFor(settings, make), markup_aed: null, source: "minimum", from: null };
    const { data: last } = await admin.from("quotation_lines").select("position").eq("quotation_id", qid).order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: req } = p.part_request_id ? await admin.from("part_requests").select("label, source_type, source_key").eq("id", p.part_request_id).maybeSingle() : { data: null };
    const parent = await parentLineFor(qid, req ? { source_type: req.source_type, source_key: req.source_key } : null);
    let chosen = true;
    if (p.option_group) {
      const { data: siblings } = await admin.from("quotation_lines").select("id").eq("quotation_id", qid).eq("option_group", p.option_group).eq("is_active", true).eq("chosen", true).limit(1);
      chosen = !(siblings ?? []).length;
    }
    await admin.from("quotation_lines").insert({ quotation_id: qid, position: (Number(last?.position) || 0) + 1, line_type: "part", ...shared, chosen, parent_line_id: parent, group_label: req?.label ?? "Parts", source_type: "manual", markup_mode: pick.markup_mode, markup_percent: pick.markup_percent, markup_aed: pick.markup_aed, part_item_id: p.id, created_by: by });
    change = "added";
    if (pick.source !== "minimum") markupNote = ` at ${markupPickWords(pick)}`;
  }
  if (change) {
    const { data: who } = by ? await admin.from("staff").select("display_name").eq("id", by).maybeSingle() : { data: null };
    const name = who?.display_name ?? "Parts";
    await logQuoteEvent(qid, jobId, by, `parts_${change}`, change === "added" ? `Parts added ${title} ×${qty}${markupNote} (${name})` : change === "removed" ? `Parts removed ${title} (${name})` : `Parts changed ${title} ×${qty}${p.cost_aed !== null ? ` at AED ${Number(p.cost_aed).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : ""} (${name})`);
  }
  await refreshQuoteTotals(qid, await getSettings(), by ?? "", { reopen: true });
  return { quotationId: qid, created: target.created, change };
}

/** Lines of a quotation, as the editor sees them (helper for routes that need the active lines). */
export async function activeLinesOf(quotationId: string): Promise<QuoteLine[]> {
  const { data } = await createAdminClient().from("quotation_lines").select(LINE_SELECT).eq("quotation_id", quotationId).eq("is_active", true).order("position");
  return ((data ?? []) as Record<string, unknown>[]).map(toLine);
}

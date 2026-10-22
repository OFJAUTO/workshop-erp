import { invoicesForLock, refuseIfLocked } from "./quote-lock-server";
import { liveInvoicesOf } from "./quote-lock";
import { notifyRoles, notifyStaff } from "@/lib/notifications";
import { LINE_SELECT, PART_SELECT, loadQuotation, logQuoteEvent, minMarkupFor, parentLineFor, refreshQuoteTotals, toLine, toPart } from "@/lib/quote-data";
import { blockOf, isHidden, type QuoteLine } from "@/lib/quotes";
import { newToken } from "@/lib/media";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

export type VersionActor = { id: string; display_name: string };

/** The line fields a new version copies: everything but the id, the quotation, the stamps and the customer's answer. */
export const COPY_FIELDS = (l: QuoteLine) => ({
  package_key: l.package_key ?? null,
  package_items: l.package_items ?? null,
  line_type: l.line_type, positions: l.positions ?? null, title: l.title, details: l.details, group_label: l.group_label, source_type: l.source_type, source_key: l.source_key,
  quantity: l.quantity, unit_cost: l.unit_cost, markup_percent: l.markup_percent, unit_price: l.unit_price, hours: l.hours, labour_rate: l.labour_rate, discount_percent: l.discount_percent,
  discount_reason: l.discount_reason, line_total: l.line_total, part_item_id: l.part_item_id, package_id: l.package_id, service_id: l.service_id, visible_to_customer: l.visible_to_customer,
  urgency: l.urgency, advisor_added: l.advisor_added, part_type: l.part_type, brand: l.brand, option_group: l.option_group, chosen: l.chosen, recovery_trips: l.recovery_trips,
  recovery_provider: l.recovery_provider, dangerous: l.dangerous, recovery_provider_kind: l.recovery_provider_kind, markup_confirmed: l.markup_confirmed,
  price_per: l.price_per ?? null, left_off: l.left_off ?? false, outside_work: l.outside_work ?? false, recovery_type: l.recovery_type ?? null, hours_estimate: l.hours_estimate ?? null,
  cut_method: l.cut_method ?? null, cut_note: l.cut_note ?? null,
  film_colour: l.film_colour ?? null, film_code: l.film_code ?? null, tint_percent: l.tint_percent ?? null, recovery_paid_by: l.recovery_paid_by ?? null, recovery_mention_free: l.recovery_mention_free ?? false,
});

const REVISABLE = ["sent", "opened", "expired", "declined", "approved", "pending_owner", "urgent_requested"];

/**
 * The next version of a quotation: every header choice and every line copied (or the urgent lines only), each line
 * remembering the line it came from, with a token of its own. A sent version is marked replaced at once; an approved
 * one stays approved until the customer approves the new version. Priced parts with no line yet are added at the end.
 */
export async function createNextVersion(quotationId: string, by: VersionActor, opts: { urgentOnly?: boolean; reason?: string } = {}): Promise<{ id: string; number: string; version: number } | { error: string }> {
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
    .insert({ kind: q.kind, number: q.number, version: q.version + 1, parent_id: q.id, token: newToken(), job_id: q.job_id, customer_id: q.customer_id, vehicle_id: q.vehicle_id, estimate_id: q.estimate_id, discount_percent: q.discount_percent, vat_percent: q.vat_percent, promised_at: q.promised_at, validity_days: q.validity_days, customer_note: q.customer_note, payment_by_card: q.payment_by_card, not_quoted: q.not_quoted ?? {}, discount_kind: q.discount_kind ?? null, discount_value: q.discount_value ?? null, discount_scope: q.discount_scope ?? "labour", expected_payment_method: q.expected_payment_method ?? "not_sure", materials_cost_aed: q.materials_cost_aed ?? null, tint_spec: q.tint_spec ?? null, ...carried, created_by: by.id, updated_by: by.id })
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
  for (const l of kept.filter((x) => !x.parent_line_id)) {
    const { data: ins } = await admin.from("quotation_lines").insert({ quotation_id: created.id, position: l.position, ...COPY_FIELDS(l), revised_from_line_id: l.id, parent_line_id: null, created_by: by.id, updated_by: by.id }).select("id").single();
    if (ins) idMap.set(l.id, ins.id);
  }
  for (const l of kept.filter((x) => x.parent_line_id)) {
    await admin.from("quotation_lines").insert({ quotation_id: created.id, position: l.position, ...COPY_FIELDS(l), revised_from_line_id: l.id, parent_line_id: idMap.get(l.parent_line_id!) ?? null, created_by: by.id, updated_by: by.id });
  }
  if (left.length && q.kind === "quotation") {
    await admin.from("declined_work").insert(left.map((l) => ({ vehicle_id: q.vehicle_id, customer_id: q.customer_id, job_id: q.job_id, quotation_id: q.id, title: l.title, details: `${l.group_label ?? ""}${l.group_label ? " · " : ""}left out of the urgent-only quotation`, amount_aed: l.line_total, declined_at: new Date().toISOString(), created_by: by.id, updated_by: by.id })));
  }
  if (["sent", "opened", "expired", "pending_owner", "urgent_requested"].includes(q.status)) await admin.from("quotations").update({ status: "superseded", updated_by: by.id }).eq("id", q.id);
  // Every priced part belongs on the quotation, Our stock included: the ones with no line yet join the new version.
  if (q.job_id && q.kind === "quotation") await syncMissingParts(q.job_id, created.id, by.id);
  await refreshQuoteTotals(created.id, await getSettings(), by.id);
  await logQuoteEvent(created.id, q.job_id, by.id, urgentOnly ? "quote_urgent_version" : "quote_revised", `${q.number} version ${q.version + 1} started by ${by.display_name}${opts.reason ? ` (${opts.reason})` : ""}${urgentOnly ? ` with the urgent work only (${kept.length} line${kept.length === 1 ? "" : "s"}; ${left.length} left out and kept as declined work)` : ""}`);
  return { id: created.id, number: q.number, version: q.version + 1 };
}

/**
 * Where a part change lands on the job's quotation: the open draft when there is one; otherwise the next version is
 * started from the latest sent or approved one, and the advisor is told to send it. Parts never think about versions.
 */
export async function quoteTargetFor(jobId: string, by: string | null, change?: string): Promise<{ id: string; created: boolean } | null> {
  const admin = createAdminClient();
  const { data: latest } = await admin.from("quotations").select("id, number, version, status, job_id, created_by, sent_by, revision_allowed_at, revision_requested_at, revision_declined_at").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).neq("status", "cancelled").order("version", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!latest) return null;
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
    await askOwnerForRevision({ id: latest.id, number: latest.number, job_id: jobId, pending: !!latest.revision_requested_at && !latest.revision_declined_at }, by, who?.display_name ?? "Parts", change ?? "Parts changed the priced parts");
    return null;
  }
  const r = await createNextVersion(latest.id, { id: by ?? latest.created_by ?? "", display_name: who?.display_name ?? "Parts" }, { reason: latest.status === "approved" ? "parts changed, allowed by the owner" : "parts changed" });
  if ("error" in r) return null;
  // The permission covers one revision.
  if (latest.status === "approved") await admin.from("quotations").update({ revision_allowed_at: null, revision_allowed_by: null, updated_by: by }).eq("id", latest.id);
  const { data: job } = await admin.from("jobs").select("job_number, gated_in_by").eq("id", jobId).maybeSingle();
  const ids = Array.from(new Set([job?.gated_in_by, latest.created_by, latest.sent_by].filter((x): x is string => !!x)));
  await notifyStaff(ids, { type: "quote_revised_by_parts", title: `Parts changed on ${job?.job_number ?? ""}: send the revised quotation`, body: `${latest.number} version ${r.version} is ready with the change from Parts. Check it and send it to the customer.`, jobId, href: `/jobs/${jobId}/quote/${r.id}?send=1` });
  return { id: r.id, created: true };
}

/**
 * A revision of an approved quotation is asked of the owner (the advisor's reason, or what Parts changed). One open
 * request at a time: a second change while the first waits adds nothing. The owner answers on the quotation page.
 */
export async function askOwnerForRevision(q: { id: string; number: string; job_id: string | null; pending: boolean }, by: string | null, byName: string, reason: string, kind: "advisor" | "parts" = "parts") {
  if (q.pending) return;
  const admin = createAdminClient();
  await admin.from("quotations").update({ revision_requested_at: new Date().toISOString(), revision_requested_by: by, revision_request_reason: reason.slice(0, 300), revision_request_kind: kind, revision_allowed_at: null, revision_allowed_by: null, revision_declined_at: null, revision_declined_by: null, revision_decision_note: null, updated_by: by }).eq("id", q.id);
  await logQuoteEvent(q.id, q.job_id, by, "revision_requested", `${q.number}: ${byName} asks to revise the approved quotation: ${reason}`);
  const { data: job } = q.job_id ? await admin.from("jobs").select("job_number").eq("id", q.job_id).maybeSingle() : { data: null };
  await notifyRoles(["owner"], { type: "revision_request", title: kind === "parts" ? `${reason}: allow revised quote?` : `Allow a revised quotation? ${q.number}${job ? ` · ${job.job_number}` : ""}`, body: kind === "parts" ? `${q.number} was approved by the customer. Allow one revision, or decline.` : `${byName}: ${reason}`, jobId: q.job_id, href: q.job_id ? `/jobs/${q.job_id}/quote/${q.id}?revise=1` : `/estimates/${q.id}` });
}

/** The priced parts of a job (Our stock included) with no line on the given quotation. */
export async function missingPricedParts(jobId: string, quotationId: string): Promise<{ id: string; description: string }[]> {
  const admin = createAdminClient();
  const [{ data: parts }, { data: lines }] = await Promise.all([
    admin.from("part_items").select("id, description, cost_aed, confirm_status, is_active, removed_at, not_needed_at").eq("job_id", jobId).eq("is_active", true).not("cost_aed", "is", null),
    admin.from("quotation_lines").select("part_item_id").eq("quotation_id", quotationId).eq("is_active", true).not("part_item_id", "is", null),
  ]);
  const have = new Set((lines ?? []).map((l) => String(l.part_item_id)));
  return (parts ?? []).filter((p) => p.confirm_status !== "rejected" && !p.removed_at && !p.not_needed_at && !have.has(p.id)).map((p) => ({ id: p.id, description: p.description }));
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
export async function syncPartLine(jobId: string, partId: string, by: string | null, quotationId?: string): Promise<{ quotationId: string | null; created: boolean; change: "added" | "changed" | "removed" | null }> {
  const admin = createAdminClient();
  // A version named outright must still be open: an approved or replaced one refuses (and the attempt is written down).
  if (quotationId) {
    const refused = await refuseIfLocked(quotationId, by, "change a part line", "Parts desk");
    if (refused) return { quotationId, created: false, change: null };
  }
  // What changed, in words, in case the owner has to be asked (the quotation was approved by the customer).
  let changeWords: string | undefined;
  if (!quotationId) {
    const [{ data: p0 }, { data: who0 }, { data: onQuote }] = await Promise.all([
      admin.from("part_items").select("description, cost_aed").eq("id", partId).maybeSingle(),
      by ? admin.from("staff").select("display_name").eq("id", by).maybeSingle() : Promise.resolve({ data: null }),
      admin.from("quotation_lines").select("id").eq("part_item_id", partId).eq("is_active", true).limit(1),
    ]);
    if (p0) changeWords = `${who0?.display_name ?? "Parts"} ${(onQuote ?? []).length ? "changed" : "added"} ${String(p0.description).toUpperCase()}${p0.cost_aed !== null && p0.cost_aed !== undefined ? `, AED ${Number(p0.cost_aed).toLocaleString("en-GB")}` : ""}`;
  }
  const target = quotationId ? { id: quotationId, created: false } : await quoteTargetFor(jobId, by, changeWords);
  if (!target) return { quotationId: null, created: false, change: null };
  const qid = target.id;
  const [{ data: pRaw }, { data: line }] = await Promise.all([
    admin.from("part_items").select(PART_SELECT).eq("id", partId).maybeSingle(),
    admin.from("quotation_lines").select("id").eq("quotation_id", qid).eq("part_item_id", partId).eq("is_active", true).maybeSingle(),
  ]);
  if (!pRaw) return { quotationId: qid, created: target.created, change: null };
  const p = toPart(pRaw as Record<string, unknown>);
  // The customer name when the advisor set one, else the supplier name; part numbers never reach a customer document.
  const title = (p.customer_name ?? "").trim() || p.description;
  const qty = Number(p.confirmed_quantity ?? p.quantity) || 1;
  const shared = { title, quantity: p.confirmed_quantity ?? p.quantity, unit_cost: p.cost_aed, part_type: p.part_type, brand: p.brand, option_group: p.option_group, positions: p.positions ?? null, updated_by: by };
  let change: "added" | "changed" | "removed" | null = null;
  if (p.confirm_status === "rejected" || !p.is_active) {
    if (line) {
      await admin.from("quotation_lines").update({ is_active: false, updated_by: by }).eq("id", line.id);
      change = "removed";
    }
  } else if (line) {
    await admin.from("quotation_lines").update(shared).eq("id", line.id);
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
    const { data: last } = await admin.from("quotation_lines").select("position").eq("quotation_id", qid).order("position", { ascending: false }).limit(1).maybeSingle();
    const { data: req } = p.part_request_id ? await admin.from("part_requests").select("label, source_type, source_key").eq("id", p.part_request_id).maybeSingle() : { data: null };
    const parent = await parentLineFor(qid, req ? { source_type: req.source_type, source_key: req.source_key } : null);
    let chosen = true;
    if (p.option_group) {
      const { data: siblings } = await admin.from("quotation_lines").select("id").eq("quotation_id", qid).eq("option_group", p.option_group).eq("is_active", true).eq("chosen", true).limit(1);
      chosen = !(siblings ?? []).length;
    }
    await admin.from("quotation_lines").insert({ quotation_id: qid, position: (Number(last?.position) || 0) + 1, line_type: "part", ...shared, chosen, parent_line_id: parent, group_label: req?.label ?? "Parts", source_type: "manual", markup_percent: minMarkupFor(settings, make), part_item_id: p.id, created_by: by });
    change = "added";
  }
  if (change) {
    const { data: who } = by ? await admin.from("staff").select("display_name").eq("id", by).maybeSingle() : { data: null };
    const name = who?.display_name ?? "Parts";
    await logQuoteEvent(qid, jobId, by, `parts_${change}`, change === "added" ? `Parts added ${title} ×${qty} (${name})` : change === "removed" ? `Parts removed ${title} (${name})` : `Parts changed ${title} ×${qty}${p.cost_aed !== null ? ` at AED ${Number(p.cost_aed).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : ""} (${name})`);
  }
  await refreshQuoteTotals(qid, await getSettings(), by ?? "", { reopen: true });
  return { quotationId: qid, created: target.created, change };
}

/** Lines of a quotation, as the editor sees them (helper for routes that need the active lines). */
export async function activeLinesOf(quotationId: string): Promise<QuoteLine[]> {
  const { data } = await createAdminClient().from("quotation_lines").select(LINE_SELECT).eq("quotation_id", quotationId).eq("is_active", true).order("position");
  return ((data ?? []) as Record<string, unknown>[]).map(toLine);
}

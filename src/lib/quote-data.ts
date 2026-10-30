import { compApprovalReason, compCost, compLinesOf, type CompCost } from "./complimentary";
import { COMP_SELECT, compReady } from "./schema-ready";
import "server-only";
import { createAdminClient } from "./supabase/admin";
import { loadInspection, INSPECTION_BUCKET, type InspectionBundle, type InspectionMediaRow } from "./inspection-data";
import { DISC_ACTIONS, LEAK_REPAIRS, LEAK_SEVERITIES, TYRE_POSITIONS, cleanPartsRows, partsRowsText } from "./inspection";
import { cleanPartsList, mergePartsList, positionsWords } from "./parts-list";
import { ownerApprovalReasons, quoteTotals, lineTotal, round2, type PartItem, type PartRequest, type QuoteLine, type QuoteRow, type QuoteSummary, type Service, type ServiceCategory } from "./quotes";
import { expectedFeeCost, type Settings } from "./settings";
import { newToken } from "./media";
import { dubaiDate } from "./jobs";
import { loadPricingRows, valuesOfPart, PRICING_PART_SELECT, type PricingPart } from "./parts-pricing";
import { rowState } from "./parts-rows";
import { costingWithRolls, type PackageCostingBase } from "./package-cost";

export const PARTS_BUCKET = "parts-diagrams";

export const QUOTE_SELECT =
  "id, kind, number, version, parent_id, job_id, customer_id, vehicle_id, estimate_id, additional_to_id, carried_job_id, status, token, discount_percent, vat_percent, subtotal_aed, discount_aed, vat_aed, total_aed, approved_total_aed, deposit_aed, promised_at, validity_days, valid_until, customer_note, customer_request_note, payment_by_card, owner_approval_reason, owner_approved_by, owner_approved_at, discount_set_by, discount_set_at, sent_at, sent_by, sent_method, sent_to_name, sent_to_phone, opened_at, responded_at, approver_name, approver_phone, decline_reason, reminded_at, completed_at, completed_by, parts_reminded_at, parts_escalated_at, danger_acknowledged_at, danger_acknowledged_by, not_quoted, rounded_total_aed, estimated_days, declined_note, viewed_full_at, declined_by, parts_price_changed_at, expected_payment_method, editing_by, editing_at, markup_skipped_at, markup_skipped_by, deposit_mode, deposit_value, deposit_set_by, deposit_set_at, deposit_skipped_at, deposit_skipped_by, revision_requested_at, revision_requested_by, revision_request_reason, revision_request_kind, revision_allowed_at, revision_allowed_by, revision_declined_at, revision_declined_by, revision_decision_note, discount_kind, discount_value, discount_scope, commission_to, commission_kind, commission_value, commission_aed, commission_paid_at, commission_paid_by, commission_status, commission_set_by, commission_set_at, commission_decided_by, commission_decided_at, commission_decision_note, materials_cost_aed, removal_ack_at, removal_ack_name, film_rolls_est, tint_spec, tint_ack_at, tint_ack_name, cancelled_at, cancel_reason, copied_from_id, created_at, created_by, updated_at";
export const LINE_SELECT = "id, quotation_id, side, position, line_type, title, details, group_label, source_type, source_key, quantity, unit_cost, markup_percent, markup_mode, markup_aed, unit_price, hours, labour_rate, discount_percent, discount_reason, line_total, part_item_id, package_id, service_id, visible_to_customer, urgency, advisor_added, customer_approved, is_active, part_type, brand, option_group, chosen, fee_kind, recovery_trips, recovery_provider, dangerous, parent_line_id, recovery_provider_kind, recovery_paid_by, recovery_mention_free, markup_confirmed, price_per, positions, left_off, recovery_type, hours_estimate, film_colour, film_code, tint_percent, revised_from_line_id, outside_work, package_key, package_items, price_display, installer_hours, cut_method, cut_note, parts_note, price_requested_at, price_requested_by, priced_at, priced_by, priced_by_advisor, price_checked_at, price_checked_by, supplier_text, part_number, availability, delivery_days";
export const SERVICE_SELECT = "id, category_id, name, department, price_aed, default_hours, price_per, usual_quantity, time_allowance_hours, includes_oil_change, description, parts_requests, position, is_active, position_ask, suggest_for, bodyshop_kind, line_kind, outside_work, installer_hours";
export const PART_SELECT = "id, job_id, part_request_id, part_number, description, customer_name, original_description, list_price_aed, discount_percent, quantity_changed_at, removed_at, removed_by, removed_reason, discount_approval_status, client_key, availability_note, quantity, diagram_path, supplier, cost_aed, availability, delivery_date, priced_by, priced_at, confirm_status, confirmed_quantity, confirmed_by, confirmed_at, reject_note, order_status, added_by_role, is_active, created_at, part_type, brand, warranty_months, option_group, question_text, question_at, question_by, answer_text, answered_at, answered_by, positions";
export const REQUEST_SELECT = "id, job_id, inspection_id, source_type, source_key, label, requested_text, status, is_active, created_at, quantity, unit, closed_reason, positions, note, catalogue_id";

/** Numbers come back from Postgres as strings; the maths wants numbers. */
function num<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T {
  const out = { ...row };
  for (const k of keys) {
    const v = out[k];
    if (v !== null && v !== undefined && v !== "") (out as Record<string, unknown>)[k as string] = Number(v);
  }
  return out;
}
const LINE_NUM: (keyof QuoteLine)[] = ["position", "quantity", "unit_cost", "markup_percent", "markup_aed", "unit_price", "hours", "labour_rate", "discount_percent", "line_total", "recovery_trips", "hours_estimate", "installer_hours"];
const QUOTE_NUM: (keyof QuoteRow)[] = ["version", "discount_percent", "vat_percent", "subtotal_aed", "discount_aed", "vat_aed", "total_aed", "approved_total_aed", "deposit_aed", "validity_days", "rounded_total_aed", "estimated_days", "discount_value", "commission_value", "commission_aed", "deposit_value"];
const PART_NUM: (keyof PartItem)[] = ["quantity", "cost_aed", "confirmed_quantity", "list_price_aed", "discount_percent"];

export const toLine = (r: Record<string, unknown>) => num(r as unknown as QuoteLine, LINE_NUM);
export const toQuote = (r: Record<string, unknown>) => num(r as unknown as QuoteRow, QUOTE_NUM);
export const toPart = (r: Record<string, unknown>) => num(r as unknown as PartItem, PART_NUM);

export type QuoteBundle = {
  quotation: QuoteRow;
  lines: QuoteLine[];
  parts: PartItem[];
  requests: PartRequest[];
  events: { id: number; event_type: string; note: string | null; created_at: string; by_name: string | null }[];
  versions: { id: string; version: number; status: string; created_at: string; created_by: string | null }[];
  customer: { id: string; full_name: string; company_name: string | null; phone: string; email: string | null; trn: string | null } | null;
  vehicle: { id: string; kind?: "car" | "loose" | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; model_year: number | null; variant: string | null; make: { name: string } | null; model: { name: string } | null } | null;
  job: { id: string; job_number: string; status: string; department: string | null; assigned_to: string | null; gated_in_by: string; is_open: boolean; inspection_fee_due: boolean; comeback_free?: boolean } | null;
  inspection: InspectionBundle | null;
  creatorName: string | null;
};

/** The owner's services list with its categories, and how often this person used each service (most used first on the picker). */
export async function loadServices(staffId: string | null): Promise<{ categories: ServiceCategory[]; services: Service[]; usage: Record<string, number> }> {
  const admin = createAdminClient();
  const [{ data: cats }, { data: svcs }, { data: used }] = await Promise.all([
    admin.from("service_categories").select("id, name, position, is_active").eq("is_active", true).order("position"),
    admin.from("services").select(SERVICE_SELECT).eq("is_active", true).order("position"),
    staffId ? admin.from("quotation_lines").select("service_id").eq("created_by", staffId).not("service_id", "is", null) : Promise.resolve({ data: [] as { service_id: string | null }[] }),
  ]);
  const usage: Record<string, number> = {};
  for (const u of used ?? []) if (u.service_id) usage[u.service_id] = (usage[u.service_id] ?? 0) + 1;
  return {
    categories: (cats ?? []) as ServiceCategory[],
    services: ((svcs ?? []) as (Service & { price_aed: number | string | null; default_hours: number | string | null })[]).map((s) => ({ ...s, price_aed: s.price_aed === null ? null : Number(s.price_aed), default_hours: s.default_hours === null ? null : Number(s.default_hours) })),
    usage,
  };
}

/** One quotation or estimate with everything the builder and the customer page need. */
export async function loadQuotation(id: string): Promise<QuoteBundle | null> {
  const admin = createAdminClient();
  const { data: q } = await admin.from("quotations").select(QUOTE_SELECT).eq("id", id).maybeSingle();
  if (!q) return null;
  const quotation = toQuote(q as Record<string, unknown>);
  // Section 5 (30 October 2026): the complimentary reason and decision, once the database has them.
  if (await compReady()) {
    const { data: comp } = await admin.from("quotations").select(COMP_SELECT).eq("id", id).maybeSingle();
    if (comp) Object.assign(quotation, comp, { comp_normal_aed: comp.comp_normal_aed === null ? null : Number(comp.comp_normal_aed), comp_cost_aed: comp.comp_cost_aed === null ? null : Number(comp.comp_cost_aed) });
    if (comp?.comp_original_job_id) quotation.comp_original_job_number = (await admin.from("jobs").select("job_number").eq("id", comp.comp_original_job_id).maybeSingle()).data?.job_number ?? null;
  }
  const [{ data: lines }, { data: parts }, { data: requests }, { data: events }, { data: versions }, { data: customer }, { data: vehicle }, { data: job }, inspection, { data: creator }] = await Promise.all([
    admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", id).eq("is_active", true).order("position"),
    quotation.job_id ? admin.from("part_items").select(PART_SELECT).eq("job_id", quotation.job_id).eq("is_active", true).order("created_at") : Promise.resolve({ data: [] }),
    quotation.job_id ? admin.from("part_requests").select(REQUEST_SELECT).eq("job_id", quotation.job_id).eq("is_active", true).order("created_at") : Promise.resolve({ data: [] }),
    admin.from("quotation_events").select("id, event_type, note, created_at, created_by").eq("quotation_id", id).order("created_at", { ascending: false }),
    admin.from("quotations").select("id, version, status, created_at, created_by").eq("number", quotation.number).eq("kind", quotation.kind).eq("is_active", true).order("version"),
    admin.from("customers").select("id, full_name, company_name, phone, email, trn").eq("id", quotation.customer_id).maybeSingle(),
    quotation.vehicle_id ? admin.from("vehicles").select("kind, id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, variant, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", quotation.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    quotation.job_id ? admin.from("jobs").select("id, job_number, status, department, assigned_to, gated_in_by, is_open, inspection_fee_due, inspection_fee_aed, comeback_free").eq("id", quotation.job_id).maybeSingle() : Promise.resolve({ data: null }),
    quotation.job_id ? loadInspection(quotation.job_id) : Promise.resolve(null),
    quotation.created_by ? admin.from("staff").select("display_name").eq("id", quotation.created_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const ids = new Set<string>();
  for (const e of events ?? []) if (e.created_by) ids.add(e.created_by);
  const { data: people } = ids.size ? await admin.from("staff").select("id, display_name").in("id", Array.from(ids)) : { data: [] as { id: string; display_name: string }[] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.display_name]));
  return {
    quotation,
    lines: ((lines ?? []) as Record<string, unknown>[]).map(toLine),
    parts: ((parts ?? []) as Record<string, unknown>[]).map(toPart),
    requests: (requests ?? []) as PartRequest[],
    events: ((events ?? []) as { id: number; event_type: string; note: string | null; created_at: string; created_by: string | null }[]).map((e) => ({ ...e, by_name: e.created_by ? (nameOf.get(e.created_by) ?? null) : null })),
    versions: (versions ?? []) as QuoteBundle["versions"],
    customer: (customer as QuoteBundle["customer"]) ?? null,
    vehicle: (vehicle as unknown as QuoteBundle["vehicle"]) ?? null,
    job: (job as QuoteBundle["job"]) ?? null,
    inspection,
    creatorName: (creator as { display_name: string } | null)?.display_name ?? null,
  };
}

/** The job's current quotation (the newest version of the newest number) and the parts state, for cards and the Next step. */
/**
 * The approved quotations of a job that count for work, parts and the invoice: one per quotation
 * number, the newest approved version. An older approved version that was revised is not counted twice.
 */
export type ApprovedQuote = { id: string; number: string; version: number; discount_percent: number; vat_percent: number; deposit_aed: number; total_aed: number; discount_kind: "percent" | "aed" | null; discount_value: number | null; discount_scope: "labour" | "labour_services" | null };
export async function approvedQuotations(jobId: string): Promise<ApprovedQuote[]> {
  const { data } = await createAdminClient().from("quotations").select("id, number, version, discount_percent, vat_percent, deposit_aed, total_aed, created_at, discount_kind, discount_value, discount_scope").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).eq("status", "approved").order("created_at");
  const best = new Map<string, ApprovedQuote>();
  for (const q of (data ?? []) as { id: string; number: string; version: number | string; discount_percent: number | string; vat_percent: number | string; deposit_aed: number | string | null; total_aed?: number | string | null; discount_kind?: string | null; discount_value?: number | string | null; discount_scope?: string | null }[]) {
    const row: ApprovedQuote = { id: q.id, number: q.number, version: Number(q.version) || 1, discount_percent: Number(q.discount_percent) || 0, vat_percent: Number(q.vat_percent) || 5, deposit_aed: Number(q.deposit_aed) || 0, total_aed: Number(q.total_aed) || 0, discount_scope: q.discount_scope === "labour_services" ? "labour_services" : "labour", discount_kind: q.discount_kind === "percent" || q.discount_kind === "aed" ? q.discount_kind : null, discount_value: q.discount_value === null || q.discount_value === undefined ? null : Number(q.discount_value) };
    const have = best.get(q.number);
    if (!have || have.version < row.version) best.set(q.number, row);
  }
  return Array.from(best.values());
}

export async function loadQuoteSummary(jobId: string): Promise<QuoteSummary> {
  const map = await loadQuoteSummaries([jobId]);
  return map.get(jobId) ?? { quotation: null, waitingPrices: 0, waitingConfirm: 0, rejectedParts: 0, openRequests: 0 };
}

/** Summaries for many jobs at once (dashboard): the latest quotation, what Parts still owe, and how far the quotation is. */
export async function loadQuoteSummaries(jobIds: string[]): Promise<Map<string, QuoteSummary>> {
  const out = new Map<string, QuoteSummary>();
  if (!jobIds.length) return out;
  const admin = createAdminClient();
  const [{ data: qs }, { data: parts }, { data: requests }, { data: doneJobs }] = await Promise.all([
    admin.from("quotations").select("id, job_id, number, version, status, token, sent_at, opened_at, responded_at, approver_name, total_aed, approved_total_aed, valid_until, promised_at, created_at, completed_at, viewed_full_at").in("job_id", jobIds).eq("is_active", true).neq("status", "superseded").order("created_at", { ascending: false }),
    admin.from("part_items").select(`job_id, ${PRICING_PART_SELECT}`).in("job_id", jobIds).eq("is_active", true),
    admin.from("part_requests").select("job_id, status").in("job_id", jobIds).eq("is_active", true),
    admin.from("jobs").select("id").in("id", jobIds).not("parts_pricing_done_at", "is", null),
  ]);
  const pricingDone = new Set((doneJobs ?? []).map((j) => j.id as string));
  for (const id of jobIds) out.set(id, { quotation: null, waitingPrices: 0, waitingConfirm: 0, rejectedParts: 0, openRequests: 0, partsTotal: 0, partsPriced: 0, labourTotal: 0, labourDone: 0 });
  for (const q of (qs ?? []) as ({ job_id: string } & Record<string, unknown>)[]) {
    const s = out.get(q.job_id)!;
    if (!s.quotation) s.quotation = toQuote(q) as QuoteSummary["quotation"];
  }
  const today = dubaiDate();
  for (const p of (parts ?? []) as unknown as (PricingPart & { job_id: string })[]) {
    const s = out.get(p.job_id)!;
    if (p.confirm_status === "pending") s.waitingConfirm++;
    if (p.confirm_status === "rejected") s.rejectedParts++;
    else {
      s.partsTotal!++;
      // The same "priced" as the Parts table: part number, type, net above 0, supplier, availability.
      if (rowState(valuesOfPart(p, today)) === "priced") s.partsPriced!++;
      else s.waitingPrices++;
    }
  }
  for (const r of (requests ?? []) as { job_id: string; status: string }[]) if (r.status === "open" && !pricingDone.has(r.job_id)) out.get(r.job_id)!.openRequests++;
  // Labour lines with hours on the latest quotation.
  const byQuotation = new Map<string, QuoteSummary>();
  for (const s of out.values()) if (s.quotation) byQuotation.set(s.quotation.id, s);
  if (byQuotation.size) {
    const { data: lines } = await admin.from("quotation_lines").select("quotation_id, hours").in("quotation_id", Array.from(byQuotation.keys())).eq("is_active", true).eq("line_type", "labour");
    for (const l of (lines ?? []) as { quotation_id: string; hours: number | string | null }[]) {
      const s = byQuotation.get(l.quotation_id);
      if (!s) continue;
      s.labourTotal!++;
      if (Number(l.hours) > 0) s.labourDone!++;
    }
  }
  return out;
}

/** The labour rate for a job's department, and the minimum parts markup for a make. */
export function labourRateFor(settings: Settings, department: string | null | undefined, make?: string | null) {
  const byMake = (settings.labour_rate_by_make ?? {}) as Record<string, number>;
  if (make && byMake[make]) return Number(byMake[make]) || 0;
  const byDept = (settings.labour_rate_by_department ?? {}) as Record<string, number>;
  const key = department === "bodyshop" ? "bodyshop" : department === "mechanical" ? "mechanical" : "";
  return Number(byDept[key] ?? settings.labour_rate_aed) || 0;
}
export function minMarkupFor(settings: Settings, make: string | null | undefined) {
  const byMake = (settings.parts_min_markup_by_make ?? {}) as Record<string, number>;
  return Number((make && byMake[make]) ?? settings.parts_min_markup_percent) || 0;
}

/**
 * Parts requests from the approved inspection: every item with "parts needed", every request's
 * "what it needs", and every tyre marked Replace. Safe to call again; existing requests stay.
 */
export async function ensurePartRequests(jobId: string, by: string): Promise<number> {
  const bundle = await loadInspection(jobId);
  if (!bundle) return 0;
  const admin = createAdminClient();
  const { data: existing } = await admin.from("part_requests").select("source_type, source_key").eq("job_id", jobId);
  const have = new Set((existing ?? []).map((e) => `${e.source_type}:${e.source_key}`));
  const rows: Record<string, unknown>[] = [];
  // The gathered parts list (from the rework of 11 October): one request per merged line, with the quantity and the positions.
  const listed = mergePartsList(cleanPartsList(bundle.inspection.parts_list));
  if (listed.length) {
    for (const line of listed) {
      const slug = line.key.replace(/[^a-z0-9]+/g, "_").slice(0, 60);
      const srcType = line.source === "tyre" ? "tyre" : "item";
      const srcKey = line.source === "tyre" ? `tyres#${slug}` : `${line.item_key ?? "list"}#${slug}`;
      if (have.has(`${srcType}:${srcKey}`)) continue;
      rows.push({
        job_id: jobId,
        inspection_id: bundle.inspection.id,
        source_type: srcType,
        source_key: srcKey,
        label: line.name,
        requested_text: [`× ${line.qty}`, positionsWords(line.positions), line.note ?? ""].filter(Boolean).join(" · "),
        quantity: line.qty,
        unit: line.unit === "set" ? "set" : "pc",
        positions: line.positions,
        note: line.note,
        catalogue_id: line.catalogue_id,
        created_by: by,
        updated_by: by,
      });
    }
    if (rows.length) await admin.from("part_requests").insert(rows);
    return rows.length;
  }
  for (const i of bundle.items) {
    const partRows = cleanPartsRows(i.parts_rows).filter((r) => r.part.trim());
    if (partRows.length) {
      // One request per part row, with the quantity the technician set; the row's number keeps it apart from its siblings.
      partRows.forEach((r, idx) => {
        const key = `${i.item_key}#${idx}`;
        if (have.has(`item:${key}`)) return;
        rows.push({ job_id: jobId, inspection_id: bundle.inspection.id, source_type: "item", source_key: key, label: `${r.part.trim()} (${i.item_label})`, requested_text: `${r.part.trim()} × ${r.qty} ${r.unit}${i.remarks ? ` · ${i.remarks}` : ""}`, quantity: r.qty, unit: r.unit, created_by: by, updated_by: by });
      });
    } else if (i.parts_needed && i.parts_needed.trim() && !have.has(`item:${i.item_key}`)) {
      rows.push({ job_id: jobId, inspection_id: bundle.inspection.id, source_type: "item", source_key: i.item_key, label: i.item_label, requested_text: i.parts_needed.trim(), created_by: by, updated_by: by });
    }
  }
  const { data: reqs } = await admin.from("job_requests").select("id, text").eq("job_id", jobId).eq("is_active", true);
  for (const f of bundle.findings) {
    const r = (reqs ?? []).find((x) => x.id === f.job_request_id);
    if (r && f.needs && f.needs.trim() && (f.status === "bad" || f.status === "average") && !have.has(`request:${r.id}`)) {
      rows.push({ job_id: jobId, inspection_id: bundle.inspection.id, source_type: "request", source_key: r.id, label: r.text, requested_text: f.needs.trim(), created_by: by, updated_by: by });
    }
  }
  const m = bundle.inspection.measurements ?? {};
  for (const p of [...TYRE_POSITIONS, { key: "spare", label: "Spare" }]) {
    const action = String(m[`tyre_${p.key}_action`] ?? "");
    if ((action === "replace_now" || action === "replace_soon") && !have.has(`tyre:${p.key}`)) {
      rows.push({ job_id: jobId, inspection_id: bundle.inspection.id, source_type: "tyre", source_key: p.key, label: `${p.label} tyre`, requested_text: `Replace ${action === "replace_now" ? "now" : "soon"}${m[`tyre_${p.key}_tread`] ? ` · ${m[`tyre_${p.key}_tread`]} mm` : ""}`, created_by: by, updated_by: by });
    }
  }
  if (rows.length) await admin.from("part_requests").insert(rows);
  return rows.length;
}

/** The suggested lines when a quotation starts: one per BAD or AVERAGE finding, item and Replace tyre, grouped under what they answer. */
export async function suggestedLines(jobId: string, labourRate: number): Promise<Omit<QuoteLine, "id" | "quotation_id" | "is_active">[]> {
  const bundle = await loadInspection(jobId);
  if (!bundle) return [];
  const admin = createAdminClient();
  const { data: reqs } = await admin.from("job_requests").select("id, text, position").eq("job_id", jobId).eq("is_active", true).order("position");
  const out: Omit<QuoteLine, "id" | "quotation_id" | "is_active">[] = [];
  let position = 0;
  const base = { price_per: null, quantity: 1, unit_cost: null, markup_percent: null, unit_price: null, hours: null, labour_rate: labourRate, discount_percent: 0, discount_reason: null, line_total: 0, part_item_id: null, package_id: null, service_id: null, visible_to_customer: true, urgency: null, advisor_added: false, customer_approved: null, part_type: null, brand: null, option_group: null, chosen: true, fee_kind: null, recovery_trips: null, recovery_provider: null, dangerous: false, parent_line_id: null, recovery_provider_kind: null, markup_confirmed: false };
  for (const r of reqs ?? []) {
    const f = bundle.findings.find((x) => x.job_request_id === r.id);
    if (!f || !(f.status === "bad" || f.status === "average")) continue;
    // The labour line is the work on the complaint; what the technician listed as parts goes to Parts as a price request, never into the title.
    out.push({ ...base, position: position++, line_type: "labour", title: "", details: null, group_label: `Request: ${r.text}`, source_type: "request", source_key: r.id });
  }
  for (const i of bundle.items) {
    if (!(i.status === "bad" || i.status === "average")) continue;
    // The title follows what the technician tapped: skim or replace a disc, repair a leak; a dangerous finding is Urgent from the start.
    const disc = DISC_ACTIONS.find((a) => a.value === i.disc_action);
    const leak = LEAK_REPAIRS.find((r) => r.value === i.leak_repair);
    const title = disc && i.disc_action === "skim" ? `Skim ${i.item_label.toLowerCase()}` : disc && i.disc_action === "replace" ? `Replace ${i.item_label.toLowerCase()}` : leak ? `${i.leak_repair === "replace" ? "Replace" : "Repair leak,"} ${i.item_label.toLowerCase()}${i.leak_repair === "replace" ? "" : ` (${leak.label.toLowerCase()})`}` : "";
    const extra = [i.leak_severity ? `${LEAK_SEVERITIES.find((s) => s.value === i.leak_severity)?.label ?? ""} leak` : "", i.fluid_qty !== null && i.fluid_qty !== undefined ? `${i.fluid_qty} ${i.fluid_unit === "g" ? "g" : "L"}${i.fluid_grade ? ` ${i.fluid_grade}` : ""}${i.fluid_spec ? ` (${i.fluid_spec})` : ""}` : i.fluid_grade ? i.fluid_grade : ""].filter(Boolean).join(" · ");
    out.push({ ...base, position: position++, line_type: "labour", title, details: [i.remarks ?? "", extra].filter(Boolean).join(" · ") || null, group_label: `${i.section_title}`, source_type: "item", source_key: i.item_key, dangerous: !!i.dangerous, urgency: i.dangerous ? "urgent" : null });
  }
  const m = bundle.inspection.measurements ?? {};
  for (const p of [...TYRE_POSITIONS, { key: "spare", label: "Spare" }]) {
    const action = String(m[`tyre_${p.key}_action`] ?? "");
    if (action === "replace_now" || action === "replace_soon") {
      const danger = String(m[`tyre_${p.key}_danger`] ?? "") === "1";
      out.push({ ...base, position: position++, line_type: "labour", title: `Replace ${p.label.toLowerCase()} tyre (fitting and balancing)`, details: m[`tyre_${p.key}_tread`] ? `${m[`tyre_${p.key}_tread`]} mm tread` : null, group_label: "Tyres", source_type: "tyre", source_key: p.key, dangerous: danger, urgency: danger ? "urgent" : null });
    }
  }
  return out;
}

/** The reasons this quotation needs the owner NOW (B3): one computation for the send, the quote page and the save route. */
export function approvalReasonsNow(bundle: Pick<QuoteBundle, "quotation" | "lines"> & { job?: QuoteBundle["job"] }, settings: Settings, discountByOwner: boolean): string[] {
  const totals = quoteTotals(bundle.lines, bundle.quotation, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const reasons = ownerApprovalReasons(bundle.quotation, bundle.lines, totals, { discountLimit: Number(settings.discount_limit_percent) || 0, approvalAbove: Number(settings.quote_owner_approval_above_aed) || 0 }, { discountByOwner });
  // Section 5 (30 October 2026): anything free goes to the owner with its reason - except a free comeback the owner
  // already decided (the warranty repair) and the free pick-up of a PPF package. Dormant until the reason can be saved.
  const q = bundle.quotation;
  const decidedComeback = !!(bundle.job as { comeback_free?: boolean } | null | undefined)?.comeback_free;
  if (q.comp_reason !== undefined && !decidedComeback) {
    const comp = compApprovalReason(bundle.lines, q, q.comp_original_job_number ?? null);
    if (comp) reasons.push(comp);
  }
  return reasons;
}

export async function refreshQuoteTotals(quotationId: string, settings: Settings, by: string, opts: { reopen?: boolean } = {}) {
  const admin = createAdminClient();
  const [{ data: q }, { data: lines }] = await Promise.all([
    admin.from("quotations").select("id, discount_percent, vat_percent, status, completed_at, rounded_total_aed, expected_payment_method, discount_kind, discount_value, discount_scope, discount_set_by, owner_approval_reason, commission_kind, commission_value, commission_status, materials_cost_aed, deposit_mode, deposit_value").eq("id", quotationId).maybeSingle(),
    admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", quotationId).eq("is_active", true),
  ]);
  if (!q) return;
  let ls = ((lines ?? []) as Record<string, unknown>[]).map(toLine);
  const stamp = by || null;
  // A change after the total was rounded and the quotation completed reopens it: the rounding is chosen again at Send.
  const reopening = !!opts.reopen && !!q.completed_at;
  const qArgs = { discount_percent: Number(q.discount_percent) || 0, vat_percent: Number(q.vat_percent) || 5, rounded_total_aed: reopening || q.rounded_total_aed === null ? null : Number(q.rounded_total_aed), discount_kind: (q.discount_kind as "percent" | "aed" | null) ?? null, discount_scope: q.discount_scope === "labour_services" ? ("labour_services" as const) : ("labour" as const), materials_cost_aed: Number(q.materials_cost_aed) || 0, discount_value: q.discount_value === null || q.discount_value === undefined ? null : Number(q.discount_value), commission_kind: (q.commission_kind as "aed" | "percent" | null) ?? null, commission_value: q.commission_value === null || q.commission_value === undefined ? null : Number(q.commission_value), commission_status: (q.commission_status as string | null) ?? null, deposit_mode: (q.deposit_mode as string | null) ?? null, deposit_value: q.deposit_value === null || q.deposit_value === undefined ? null : Number(q.deposit_value) };
  // The automatic bank charge: one hidden Fee line at the set percentage of the total including VAT.
  // Never shown to the customer, counted as a cost against profit, corrected by the real charge at payment.
  if (q.status === "draft" || q.status === "pending_owner") {
    // MSF % + the fee per transaction, before the reclaimable VAT (bank-fees.ts).
    const others = ls.filter((l) => l.fee_kind !== "bank_charge");
    const fee = expectedFeeCost(settings, String(q.expected_payment_method ?? "not_sure"), quoteTotals(others, qArgs).total);
    const existing = ls.filter((l) => l.fee_kind === "bank_charge");
    if (existing.length === 0 && fee > 0) {
      const { data: created } = await admin.from("quotation_lines").insert({ quotation_id: quotationId, position: 9999, line_type: "fee", fee_kind: "bank_charge", title: "Bank charge (card or payment link)", details: null, group_label: null, source_type: "manual", quantity: 1, unit_cost: fee, unit_price: 0, markup_percent: 0, discount_percent: 0, visible_to_customer: false, line_total: 0, created_by: stamp, updated_by: stamp }).select(LINE_SELECT).single();
      if (created) ls = [...ls, toLine(created as Record<string, unknown>)];
    } else if (existing.length) {
      const [keep, ...extra] = existing;
      for (const e of extra) await admin.from("quotation_lines").update({ is_active: false, updated_by: stamp }).eq("id", e.id);
      ls = ls.filter((l) => !extra.some((e) => e.id === l.id));
      if (round2(keep.unit_cost ?? 0) !== fee) {
        await admin.from("quotation_lines").update({ unit_cost: fee, updated_by: stamp }).eq("id", keep.id);
        keep.unit_cost = fee;
      }
    }
  }
  // Keep each line's stored total in step with its inputs.
  for (const l of ls) {
    const t = lineTotal(l);
    if (round2(l.line_total) !== t) await admin.from("quotation_lines").update({ line_total: t, updated_by: stamp }).eq("id", l.id);
  }
  const responded = q.status === "approved";
  const totals = quoteTotals(ls, qArgs, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const patch: Record<string, unknown> = { subtotal_aed: totals.subtotal, discount_aed: totals.discount, vat_aed: totals.vat, total_aed: totals.total, deposit_aed: totals.deposit, commission_aed: totals.commission, updated_by: stamp };
  if (responded) patch.approved_total_aed = quoteTotals(ls, qArgs, { onlyApproved: true }).total;
  // A change after "Quotation complete" reopens it: the advisor checks it again before sending.
  if (reopening) Object.assign(patch, { completed_at: null, completed_by: null, rounded_total_aed: null });
  // Waiting for the owner: his box always shows what would go out now (B3 review), so he never approves old figures.
  // With nothing left that needs him, it goes back to the advisor.
  if (q.status === "pending_owner") {
    const setter = (q.discount_set_by as string | null) ?? null;
    const { data: setterRow } = setter ? await admin.from("staff").select("role_id").eq("id", setter).maybeSingle() : { data: null };
    const left = ownerApprovalReasons(qArgs, ls, totals, { discountLimit: Number(settings.discount_limit_percent) || 0, approvalAbove: Number(settings.quote_owner_approval_above_aed) || 0 }, { discountByOwner: setterRow?.role_id === "owner" });
    if (!left.length) Object.assign(patch, { status: "draft", owner_approval_reason: null });
    else if (left.join("; ") !== ((q.owner_approval_reason as string | null) ?? "")) patch.owner_approval_reason = left.join("; ");
  }
  const { error } = await admin.from("quotations").update(patch).eq("id", quotationId);
  if (error) console.error("refreshQuoteTotals", error.message);
}

export async function logQuoteEvent(quotationId: string, jobId: string | null, by: string | null, event_type: string, note: string) {
  const admin = createAdminClient();
  await admin.from("quotation_events").insert({ quotation_id: quotationId, job_id: jobId, event_type, note, created_by: by });
  if (jobId) await admin.from("job_events").insert({ job_id: jobId, event_type, note, created_by: by });
}

/** A fresh customer token for a quotation. */
export function quoteToken() {
  return newToken();
}

/** Signed addresses for the parts diagrams and the inspection photos a quotation refers to. */
export async function signPaths(bucket: string, paths: string[], seconds = 3600): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!paths.length) return out;
  const admin = createAdminClient();
  const { data } = await admin.storage.from(bucket).createSignedUrls(paths, seconds);
  for (const s of data ?? []) if (s.path && s.signedUrl) out[s.path] = s.signedUrl;
  return out;
}

export { INSPECTION_BUCKET };

/** What the send checks need from the job: open part requests and the workshop's estimated hours (agreed by the manager or not). */
export async function loadQuoteChecks(jobId: string | null): Promise<{ openRequests: number; workshopEstimate: { hours: number | null; managerHours: number | null; agreed: boolean } | null }> {
  if (!jobId) return { openRequests: 0, workshopEstimate: null };
  const admin = createAdminClient();
  const [pricing, { data: insp }, { data: jobRow }] = await Promise.all([
    loadPricingRows(jobId),
    admin.from("inspections").select("estimated_hours, estimated_hours_manager").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("jobs").select("parts_pricing_done_at").eq("id", jobId).maybeSingle(),
  ]);
  // Parts pressed "Pricing done": whatever is still open no longer holds the advisor. Otherwise every row that is
  // not finished or waiting for the owner's approval does (the same state function as the Parts table).
  const pricingDone = !!jobRow?.parts_pricing_done_at;
  const hours = insp?.estimated_hours === null || insp?.estimated_hours === undefined ? null : Number(insp.estimated_hours);
  const managerHours = insp?.estimated_hours_manager === null || insp?.estimated_hours_manager === undefined ? null : Number(insp.estimated_hours_manager);
  return { openRequests: pricingDone ? 0 : pricing.summary.open, workshopEstimate: hours === null ? null : { hours, managerHours, agreed: managerHours !== null } };
}

/** How long the advisor has been waiting on Parts: the oldest open request or unpriced part, in minutes, and who the Parts people are. */
export async function loadPartsWait(jobId: string): Promise<{ count: number; minutes: number; names: string[] }> {
  const admin = createAdminClient();
  const [pricing, { data: people }] = await Promise.all([
    loadPricingRows(jobId),
    admin.from("staff").select("display_name").eq("role_id", "parts").eq("is_active", true).order("display_name"),
  ]);
  const stamps = pricing.rows.filter((r) => r.state === "not_finished" || r.state === "waiting_approval").map((r) => Date.parse(r.createdAt)).filter((t) => Number.isFinite(t));
  const minutes = stamps.length ? Math.max(0, Math.floor((Date.now() - Math.min(...stamps)) / 60000)) : 0;
  return { count: stamps.length, minutes, names: (people ?? []).map((p) => p.display_name as string) };
}

/* ---------------------------------------------------------------------------
   The findings a quotation answers (overnight round 3). Each BAD or AVERAGE
   finding of the approved inspection is a heading in the labour block, with the
   labour lines for it underneath; a part belongs to the labour line of the
   finding its request came from.
   --------------------------------------------------------------------------- */

export type QuoteFinding = {
  /** "request:<id>", "item:<key>" or "tyre:<pos>": the same key the lines carry in source_type and source_key. */
  key: string;
  source_type: "request" | "item" | "tyre";
  source_key: string;
  status: "bad" | "average" | "good" | null;
  /** The heading: "Oil leaks · Engine top side", "Request: A/C not cooling", "Rear left tyre". */
  label: string;
  section: string | null;
  remark: string | null;
  parts: string | null;
  photos: string[];
  dangerous: boolean;
};

/** The findings of the approved report, in the order they appear on it: customer requests first. */
export async function loadQuoteFindings(jobId: string): Promise<QuoteFinding[]> {
  const bundle = await loadInspection(jobId);
  if (!bundle) return [];
  const admin = createAdminClient();
  const { data: reqs } = await admin.from("job_requests").select("id, text, position").eq("job_id", jobId).eq("is_active", true).order("position");
  const out: QuoteFinding[] = [];
  const photosFor = (filter: (m: InspectionMediaRow) => boolean) => bundle.media.filter((m) => m.kind === "photo" && filter(m)).map((m) => bundle.mediaUrls[m.storage_path]).filter((u): u is string => !!u);
  // Every customer request is a heading on the quotation, whatever the technician found.
  for (const r of reqs ?? []) {
    const f = bundle.findings.find((x) => x.job_request_id === r.id);
    const status = f?.status === "bad" || f?.status === "average" || f?.status === "good" ? f.status : null;
    out.push({ key: `request:${r.id}`, source_type: "request", source_key: r.id, status, label: `Request: ${r.text}`, section: null, remark: [f?.found, f?.needs ? `Needs: ${f.needs}` : ""].filter(Boolean).join(" · ") || null, parts: f?.needs ?? null, photos: photosFor((m) => m.job_request_id === r.id), dangerous: false });
  }
  for (const i of bundle.items) {
    if (!(i.status === "bad" || i.status === "average")) continue;
    const rows = cleanPartsRows(i.parts_rows);
    out.push({ key: `item:${i.item_key}`, source_type: "item", source_key: i.item_key, status: i.status, label: `${i.section_title} · ${i.item_label}`, section: i.section_title, remark: i.remarks ?? null, parts: rows.length ? partsRowsText(rows).replace(/\n/g, "; ") : (i.parts_needed ?? null), photos: photosFor((m) => m.item_key === i.item_key), dangerous: !!i.dangerous });
  }
  const m = bundle.inspection.measurements ?? {};
  for (const p of [...TYRE_POSITIONS, { key: "spare", label: "Spare" }]) {
    const action = String(m[`tyre_${p.key}_action`] ?? "");
    if (action !== "replace_now" && action !== "replace_soon") continue;
    out.push({ key: `tyre:${p.key}`, source_type: "tyre", source_key: p.key, status: action === "replace_now" ? "bad" : "average", label: `${p.label} tyre`, section: "Tyres", remark: [m[`tyre_${p.key}_tread`] ? `${m[`tyre_${p.key}_tread`]} mm tread` : "", action === "replace_now" ? "Replace now" : "Replace soon"].filter(Boolean).join(" · "), parts: `${p.label} tyre`, photos: [], dangerous: String(m[`tyre_${p.key}_danger`] ?? "") === "1" });
  }
  return out;
}

/** The labour line of this quotation that answers a part request's finding, so the part can sit under it. */
export async function parentLineFor(quotationId: string, request: { source_type: string; source_key: string } | null): Promise<string | null> {
  if (!request) return null;
  const base = request.source_key.split("#")[0];
  const { data } = await createAdminClient().from("quotation_lines").select("id, source_type, source_key, position").eq("quotation_id", quotationId).eq("is_active", true).in("line_type", ["labour", "package"]).order("position");
  const hit = (data ?? []).find((l) => l.source_type === request.source_type && l.source_key === base);
  return hit?.id ?? null;
}

/**
 * Section 7 (21 October): the numbers the editor needs to fill a package's INTERNAL cost estimate by
 * itself - film roll prices (gloss and matte), tint and ceramic per car, this month's consumables share,
 * the package installer hours, the bodyshop rate, and whether this car counts as big (more film).
 */
export type PackageCosting = PackageCostingBase;

/** Film rolls used per job on this model before: the most (worst case), from the film recorded on the jobs. */
async function rollsUsedOnModel(modelId: string, rollLengthM: number): Promise<{ rolls: number; jobNumber: string } | null> {
  const { data } = await createAdminClient()
    .from("film_usage")
    .select("job_id, metres, roll:film_rolls(kind, length_m), job:jobs!inner(job_number, vehicle:vehicles!inner(model_id))")
    .eq("is_active", true)
    .eq("job.vehicle.model_id", modelId);
  const perJob = new Map<string, { metres: number; length: number; number: string }>();
  for (const r of (data ?? []) as unknown as { job_id: string; metres: number | string; roll: { kind: string; length_m: number | string | null } | null; job: { job_number: string } }[]) {
    if (r.roll?.kind === "tint") continue;
    const cur = perJob.get(r.job_id) ?? { metres: 0, length: Number(r.roll?.length_m) || rollLengthM, number: r.job.job_number };
    cur.metres += Number(r.metres) || 0;
    perJob.set(r.job_id, cur);
  }
  let best: { rolls: number; jobNumber: string } | null = null;
  for (const v of perJob.values()) {
    const rolls = Math.ceil((v.metres / Math.max(1, v.length)) * 10) / 10;
    if (rolls > 0 && (!best || rolls > best.rolls)) best = { rolls, jobNumber: v.number };
  }
  return best;
}

/**
 * The figures a package is costed with (Settings, the car, the quotation's film rolls and tint specification): ONE
 * source for the editor's profit list, the completion check, the profit page and the daily target (30 October 2026).
 * Film rolls by default (section 3.3): the most used on the same model before (worst case), else the car's size (a big
 * car, e.g. a G63, 1.5 rolls by Settings), else 1. The advisor may raise it; lowering it below the default needs a note.
 */
export async function packageCostingOf(settings: Settings, carTitle: string | null, filmRollsEst: number | string | null | undefined, tintSpec?: unknown, vehicleId?: string | null): Promise<PackageCosting> {
  const { isBigCar } = await import("./package-cost");
  const { cleanTintSpec, tintCostFactor } = await import("./tint");
  const tint = tintCostFactor(cleanTintSpec(tintSpec), Number(settings.tint_double_layer_hours) >= 0 ? Number(settings.tint_double_layer_hours) || 0 : 1);
  const films = ((settings.film_types ?? []) as { name: string; roll_price: number; roll_m: number }[]).filter((f) => f?.name);
  const gloss = films.find((f) => /gloss/i.test(f.name)) ?? films[0] ?? { roll_price: 1429, roll_m: 15 };
  const matte = films.find((f) => /matt/i.test(f.name)) ?? gloss;
  const consumablesPerCar = await consumablesPerCarThisMonth(settings);
  const bigCar = isBigCar(carTitle, ((settings.big_car_models ?? []) as string[]).map(String));
  const bigRolls = Number(settings.big_car_film_rolls) || 1.5;
  const { data: car } = vehicleId ? await createAdminClient().from("vehicles").select("model_id, model:vehicle_models(name)").eq("id", vehicleId).maybeSingle() : { data: null };
  const past = car?.model_id ? await rollsUsedOnModel(car.model_id as string, Number((gloss as { roll_m?: number }).roll_m) || 15) : null;
  const modelName = (car?.model as unknown as { name: string } | null)?.name ?? "this model";
  const defaultRolls = past ? past.rolls : bigCar ? bigRolls : 1;
  const rollsWhy = past ? `the most used on a ${modelName} before: ${past.rolls} roll${past.rolls === 1 ? "" : "s"} (${past.jobNumber})` : bigCar ? `a big car: ${bigRolls} rolls (Settings)` : "standard: 1 roll";
  return {
    filmRollPriceGloss: Number(gloss.roll_price) || 1429,
    filmRollPriceMatte: Number(matte.roll_price) || 1524,
    tintPerCar: Math.round(((Number(settings.tint_roll_price_aed) || 1200) / (Number(settings.tint_cars_per_roll) || 10)) * 100) / 100,
    ceramicExteriorPerCar: Math.round(((Number(settings.ceramic_bottle_price_aed) || 300) / (Number(settings.ceramic_cars_exterior_per_bottle) || 4)) * 100) / 100,
    ceramicInteriorPerCar: Math.round(((Number(settings.ceramic_bottle_price_aed) || 300) / (Number(settings.ceramic_cars_interior_per_bottle) || 5.5)) * 100) / 100,
    consumablesPerCar,
    packageHours: Number(settings.package_installer_hours) || 80,
    ratePerHour: Number(settings.bodyshop_cost_rate_aed) || 50,
    bigCar,
    bigRolls,
    rollsEst: filmRollsEst === null || filmRollsEst === undefined || filmRollsEst === "" ? null : Number(filmRollsEst),
    defaultRolls,
    rollsWhy,
    tintFactor: tint.factor,
    tintExtraHours: tint.extraHours,
  };
}

/** This month's consumables share per bodyshop car (the monthly amount over the bodyshop cars gated in this month), kept for ten minutes. */
let consumablesMemo: { at: number; value: number; monthly: number } | null = null;
async function consumablesPerCarThisMonth(settings: Settings): Promise<number> {
  const monthly = Number(settings.bodyshop_consumables_monthly_aed) || 1500;
  const now = Date.now();
  if (consumablesMemo && consumablesMemo.monthly === monthly && now - consumablesMemo.at < 600_000) return consumablesMemo.value;
  const monthStart = new Date(now + 4 * 3600000).toISOString().slice(0, 7) + "-01";
  const { count } = await createAdminClient().from("jobs").select("id", { count: "exact", head: true }).in("department", ["bodyshop", "both"]).gte("gated_in_at", monthStart);
  const value = Math.round((monthly / Math.max(1, count ?? 1)) * 100) / 100;
  consumablesMemo = { at: now, value, monthly };
  return value;
}

/** The costing for one quotation (its car, film rolls and tint), or null when it has no package line. */
export async function packageCostingForQuote(settings: Settings, q: { vehicle_id?: string | null; film_rolls_est?: number | string | null; tint_spec?: unknown }, hasPackage: boolean): Promise<import("./package-cost").PackageCosting | null> {
  if (!hasPackage) return null;
  const { data: v } = q.vehicle_id ? await createAdminClient().from("vehicles").select("variant, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", q.vehicle_id).maybeSingle() : { data: null };
  const car = v as unknown as { variant: string | null; make: { name: string } | null; model: { name: string } | null } | null;
  const base = await packageCostingOf(settings, [car?.make?.name, car?.model?.name, car?.variant].filter(Boolean).join(" "), q.film_rolls_est ?? null, q.tint_spec, q.vehicle_id ?? null);
  return costingWithRolls(base);
}

/**
 * Section 5 (30 October 2026): what the free part of a quotation costs us, from THE calculation with the same costing as
 * the editor (film, tint, ceramic and consumables worked out; labour at the cost rates). Null when nothing is free.
 */
export async function compCostForBundle(bundle: Pick<QuoteBundle, "quotation" | "lines"> & { job?: QuoteBundle["job"] }, settings: Settings): Promise<{ cost: CompCost; what: string[] } | null> {
  const q = bundle.quotation;
  if (q.comp_reason === undefined || (bundle.job as { comeback_free?: boolean } | null | undefined)?.comeback_free) return null;
  const free = compLinesOf(bundle.lines, q);
  if (!free.length) return null;
  const costing = await packageCostingForQuote(settings, q as { vehicle_id?: string | null; film_rolls_est?: number | null; tint_spec?: unknown }, true);
  const technician = Number(settings.technician_cost_rate_aed) || 0;
  const bodyshop = Number(settings.bodyshop_cost_rate_aed) || costing?.ratePerHour || 50;
  return { cost: compCost(free, q, { technicianCostRate: technician, bodyshopRate: bodyshop, packageCosting: costing }, { technician, bodyshop }), what: free.map((l) => l.title || "line") };
}

/** The complimentary box's choices (section 5): this customer's and this car's earlier jobs, newest first. Null until the database has it. */
export async function compJobChoices(q: Pick<QuoteRow, "job_id" | "customer_id" | "vehicle_id">, job?: { comeback_free?: boolean } | null): Promise<{ jobs: { id: string; label: string }[]; decidedComeback: boolean } | null> {
  if (!(await compReady())) return null;
  const admin = createAdminClient();
  const ors = [q.customer_id ? `customer_id.eq.${q.customer_id}` : null, q.vehicle_id ? `vehicle_id.eq.${q.vehicle_id}` : null].filter(Boolean).join(",");
  if (!ors) return { jobs: [], decidedComeback: !!job?.comeback_free };
  const { data } = await admin.from("jobs").select("id, job_number, gated_in_at, gated_out_at").or(ors).not("gated_in_at", "is", null).order("gated_in_at", { ascending: false }).limit(40);
  const day = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Dubai" }).format(new Date(iso)) : "");
  return {
    jobs: (data ?? []).filter((j) => j.id !== q.job_id).map((j) => ({ id: j.id, label: `${j.job_number} · in ${day(j.gated_in_at)}${j.gated_out_at ? ` · out ${day(j.gated_out_at)}` : " · still with us"}` })),
    decidedComeback: !!job?.comeback_free,
  };
}

/** The reason the job's approved free work is free (section 5.6), for the invoice's wording; null before the migration or when none. */
export async function compReasonForJob(jobId: string | null | undefined): Promise<string | null> {
  if (!jobId || !(await compReady())) return null;
  const { data } = await createAdminClient().from("quotations").select("comp_reason").eq("job_id", jobId).eq("status", "approved").not("comp_reason", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as { comp_reason?: string | null } | null)?.comp_reason ?? null;
}

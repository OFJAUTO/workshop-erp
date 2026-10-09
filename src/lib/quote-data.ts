import "server-only";
import { createAdminClient } from "./supabase/admin";
import { loadInspection, INSPECTION_BUCKET, type InspectionBundle } from "./inspection-data";
import { TYRE_POSITIONS } from "./inspection";
import { quoteTotals, lineTotal, round2, type PartItem, type PartRequest, type QuoteLine, type QuoteRow, type QuoteSummary, type Service, type ServiceCategory } from "./quotes";
import type { Settings } from "./settings";
import { newToken } from "./media";

export const PARTS_BUCKET = "parts-diagrams";

export const QUOTE_SELECT =
  "id, kind, number, version, parent_id, job_id, customer_id, vehicle_id, estimate_id, status, token, discount_percent, vat_percent, subtotal_aed, discount_aed, vat_aed, total_aed, approved_total_aed, deposit_aed, promised_at, validity_days, valid_until, customer_note, customer_request_note, payment_by_card, owner_approval_reason, owner_approved_by, owner_approved_at, sent_at, sent_by, sent_method, sent_to_name, sent_to_phone, opened_at, responded_at, approver_name, approver_phone, decline_reason, reminded_at, created_at, created_by, updated_at";
export const LINE_SELECT = "id, quotation_id, position, line_type, title, details, group_label, source_type, source_key, quantity, unit_cost, markup_percent, unit_price, hours, labour_rate, discount_percent, discount_reason, line_total, part_item_id, package_id, service_id, visible_to_customer, urgency, advisor_added, customer_approved, is_active";
export const SERVICE_SELECT = "id, category_id, name, department, price_aed, default_hours, description, parts_requests, position, is_active";
export const PART_SELECT = "id, job_id, part_request_id, part_number, description, quantity, diagram_path, supplier, cost_aed, availability, delivery_date, priced_by, priced_at, confirm_status, confirmed_quantity, confirmed_by, confirmed_at, reject_note, order_status, added_by_role, is_active, created_at";
export const REQUEST_SELECT = "id, job_id, inspection_id, source_type, source_key, label, requested_text, status, is_active, created_at";

/** Numbers come back from Postgres as strings; the maths wants numbers. */
function num<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T {
  const out = { ...row };
  for (const k of keys) {
    const v = out[k];
    if (v !== null && v !== undefined && v !== "") (out as Record<string, unknown>)[k as string] = Number(v);
  }
  return out;
}
const LINE_NUM: (keyof QuoteLine)[] = ["position", "quantity", "unit_cost", "markup_percent", "unit_price", "hours", "labour_rate", "discount_percent", "line_total"];
const QUOTE_NUM: (keyof QuoteRow)[] = ["version", "discount_percent", "vat_percent", "subtotal_aed", "discount_aed", "vat_aed", "total_aed", "approved_total_aed", "deposit_aed", "validity_days"];
const PART_NUM: (keyof PartItem)[] = ["quantity", "cost_aed", "confirmed_quantity"];

export const toLine = (r: Record<string, unknown>) => num(r as unknown as QuoteLine, LINE_NUM);
export const toQuote = (r: Record<string, unknown>) => num(r as unknown as QuoteRow, QUOTE_NUM);
export const toPart = (r: Record<string, unknown>) => num(r as unknown as PartItem, PART_NUM);

export type QuoteBundle = {
  quotation: QuoteRow;
  lines: QuoteLine[];
  parts: PartItem[];
  requests: PartRequest[];
  events: { id: number; event_type: string; note: string | null; created_at: string; by_name: string | null }[];
  versions: { id: string; version: number; status: string; created_at: string }[];
  customer: { id: string; full_name: string; company_name: string | null; phone: string; email: string | null; trn: string | null } | null;
  vehicle: { id: string; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; model_year: number | null; variant: string | null; make: { name: string } | null; model: { name: string } | null } | null;
  job: { id: string; job_number: string; status: string; department: string | null; assigned_to: string | null; gated_in_by: string; is_open: boolean; inspection_fee_due: boolean } | null;
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
  const [{ data: lines }, { data: parts }, { data: requests }, { data: events }, { data: versions }, { data: customer }, { data: vehicle }, { data: job }, inspection, { data: creator }] = await Promise.all([
    admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", id).eq("is_active", true).order("position"),
    quotation.job_id ? admin.from("part_items").select(PART_SELECT).eq("job_id", quotation.job_id).eq("is_active", true).order("created_at") : Promise.resolve({ data: [] }),
    quotation.job_id ? admin.from("part_requests").select(REQUEST_SELECT).eq("job_id", quotation.job_id).eq("is_active", true).order("created_at") : Promise.resolve({ data: [] }),
    admin.from("quotation_events").select("id, event_type, note, created_at, created_by").eq("quotation_id", id).order("created_at", { ascending: false }),
    admin.from("quotations").select("id, version, status, created_at").eq("number", quotation.number).eq("kind", quotation.kind).order("version"),
    admin.from("customers").select("id, full_name, company_name, phone, email, trn").eq("id", quotation.customer_id).maybeSingle(),
    quotation.vehicle_id ? admin.from("vehicles").select("id, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, model_year, variant, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", quotation.vehicle_id).maybeSingle() : Promise.resolve({ data: null }),
    quotation.job_id ? admin.from("jobs").select("id, job_number, status, department, assigned_to, gated_in_by, is_open, inspection_fee_due").eq("id", quotation.job_id).maybeSingle() : Promise.resolve({ data: null }),
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
export async function loadQuoteSummary(jobId: string): Promise<QuoteSummary> {
  const admin = createAdminClient();
  const [{ data: q }, { data: parts }, { data: requests }] = await Promise.all([
    admin.from("quotations").select("id, number, version, status, token, sent_at, opened_at, responded_at, approver_name, total_aed, approved_total_aed, valid_until, promised_at, created_at").eq("job_id", jobId).eq("is_active", true).neq("status", "superseded").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("part_items").select("id, cost_aed, confirm_status").eq("job_id", jobId).eq("is_active", true),
    admin.from("part_requests").select("id, status").eq("job_id", jobId).eq("is_active", true),
  ]);
  const items = (parts ?? []) as { cost_aed: number | null; confirm_status: string }[];
  return {
    quotation: q ? (toQuote(q as Record<string, unknown>) as QuoteSummary["quotation"]) : null,
    waitingPrices: items.filter((p) => p.confirm_status !== "rejected" && p.cost_aed === null).length,
    waitingConfirm: items.filter((p) => p.confirm_status === "pending").length,
    rejectedParts: items.filter((p) => p.confirm_status === "rejected").length,
    openRequests: ((requests ?? []) as { status: string }[]).filter((r) => r.status === "open").length,
  };
}

/** Summaries for many jobs at once (dashboard). */
export async function loadQuoteSummaries(jobIds: string[]): Promise<Map<string, QuoteSummary>> {
  const out = new Map<string, QuoteSummary>();
  if (!jobIds.length) return out;
  const admin = createAdminClient();
  const [{ data: qs }, { data: parts }, { data: requests }] = await Promise.all([
    admin.from("quotations").select("id, job_id, number, version, status, token, sent_at, opened_at, responded_at, approver_name, total_aed, approved_total_aed, valid_until, promised_at, created_at").in("job_id", jobIds).eq("is_active", true).neq("status", "superseded").order("created_at", { ascending: false }),
    admin.from("part_items").select("job_id, cost_aed, confirm_status").in("job_id", jobIds).eq("is_active", true),
    admin.from("part_requests").select("job_id, status").in("job_id", jobIds).eq("is_active", true),
  ]);
  for (const id of jobIds) out.set(id, { quotation: null, waitingPrices: 0, waitingConfirm: 0, rejectedParts: 0, openRequests: 0 });
  for (const q of (qs ?? []) as ({ job_id: string } & Record<string, unknown>)[]) {
    const s = out.get(q.job_id)!;
    if (!s.quotation) s.quotation = toQuote(q) as QuoteSummary["quotation"];
  }
  for (const p of (parts ?? []) as { job_id: string; cost_aed: number | null; confirm_status: string }[]) {
    const s = out.get(p.job_id)!;
    if (p.confirm_status === "pending") s.waitingConfirm++;
    if (p.confirm_status !== "rejected" && p.cost_aed === null) s.waitingPrices++;
    if (p.confirm_status === "rejected") s.rejectedParts++;
  }
  for (const r of (requests ?? []) as { job_id: string; status: string }[]) if (r.status === "open") out.get(r.job_id)!.openRequests++;
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
  for (const i of bundle.items) {
    if (i.parts_needed && i.parts_needed.trim() && !have.has(`item:${i.item_key}`)) {
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
  const base = { quantity: 1, unit_cost: null, markup_percent: null, unit_price: null, hours: null, labour_rate: labourRate, discount_percent: 0, discount_reason: null, line_total: 0, part_item_id: null, package_id: null, service_id: null, visible_to_customer: true, urgency: null, advisor_added: false, customer_approved: null };
  for (const r of reqs ?? []) {
    const f = bundle.findings.find((x) => x.job_request_id === r.id);
    if (!f || !(f.status === "bad" || f.status === "average")) continue;
    out.push({ ...base, position: position++, line_type: "labour", title: f.needs?.trim() || `Attend to: ${r.text}`, details: f.found ?? null, group_label: `Request: ${r.text}`, source_type: "request", source_key: r.id });
  }
  for (const i of bundle.items) {
    if (!(i.status === "bad" || i.status === "average")) continue;
    out.push({ ...base, position: position++, line_type: "labour", title: i.item_label, details: i.remarks ?? null, group_label: `${i.section_title}`, source_type: "item", source_key: i.item_key });
  }
  const m = bundle.inspection.measurements ?? {};
  for (const p of [...TYRE_POSITIONS, { key: "spare", label: "Spare" }]) {
    const action = String(m[`tyre_${p.key}_action`] ?? "");
    if (action === "replace_now" || action === "replace_soon") {
      out.push({ ...base, position: position++, line_type: "labour", title: `Replace ${p.label.toLowerCase()} tyre (fitting and balancing)`, details: m[`tyre_${p.key}_tread`] ? `${m[`tyre_${p.key}_tread`]} mm tread` : null, group_label: "Tyres", source_type: "tyre", source_key: p.key });
    }
  }
  return out;
}

/** Recomputes and stores the totals of a quotation from its lines. */
export async function refreshQuoteTotals(quotationId: string, settings: Settings, by: string) {
  const admin = createAdminClient();
  const [{ data: q }, { data: lines }] = await Promise.all([
    admin.from("quotations").select("id, discount_percent, vat_percent, status").eq("id", quotationId).maybeSingle(),
    admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", quotationId).eq("is_active", true),
  ]);
  if (!q) return;
  const ls = ((lines ?? []) as Record<string, unknown>[]).map(toLine);
  // Keep each line's stored total in step with its inputs.
  for (const l of ls) {
    const t = lineTotal(l);
    if (round2(l.line_total) !== t) await admin.from("quotation_lines").update({ line_total: t, updated_by: by || null }).eq("id", l.id);
  }
  const responded = q.status === "approved";
  const totals = quoteTotals(ls, { discount_percent: Number(q.discount_percent) || 0, vat_percent: Number(q.vat_percent) || 5 }, { depositThreshold: Number(settings.deposit_threshold_aed) || 0, depositPercent: Number(settings.deposit_percent) || 50 });
  const patch: Record<string, unknown> = { subtotal_aed: totals.subtotal, discount_aed: totals.discount, vat_aed: totals.vat, total_aed: totals.total, deposit_aed: totals.deposit, updated_by: by || null };
  if (responded) patch.approved_total_aed = quoteTotals(ls, { discount_percent: Number(q.discount_percent) || 0, vat_percent: Number(q.vat_percent) || 5 }, { onlyApproved: true }).total;
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

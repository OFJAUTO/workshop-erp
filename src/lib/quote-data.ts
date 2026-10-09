import "server-only";
import { createAdminClient } from "./supabase/admin";
import { loadInspection, INSPECTION_BUCKET, type InspectionBundle } from "./inspection-data";
import { DISC_ACTIONS, LEAK_REPAIRS, LEAK_SEVERITIES, TYRE_POSITIONS, cleanPartsRows } from "./inspection";
import { quoteTotals, lineTotal, round2, type PartItem, type PartRequest, type QuoteLine, type QuoteRow, type QuoteSummary, type Service, type ServiceCategory } from "./quotes";
import type { Settings } from "./settings";
import { newToken } from "./media";

export const PARTS_BUCKET = "parts-diagrams";

export const QUOTE_SELECT =
  "id, kind, number, version, parent_id, job_id, customer_id, vehicle_id, estimate_id, status, token, discount_percent, vat_percent, subtotal_aed, discount_aed, vat_aed, total_aed, approved_total_aed, deposit_aed, promised_at, validity_days, valid_until, customer_note, customer_request_note, payment_by_card, owner_approval_reason, owner_approved_by, owner_approved_at, sent_at, sent_by, sent_method, sent_to_name, sent_to_phone, opened_at, responded_at, approver_name, approver_phone, decline_reason, reminded_at, completed_at, completed_by, parts_reminded_at, parts_escalated_at, danger_acknowledged_at, danger_acknowledged_by, created_at, created_by, updated_at";
export const LINE_SELECT = "id, quotation_id, position, line_type, title, details, group_label, source_type, source_key, quantity, unit_cost, markup_percent, unit_price, hours, labour_rate, discount_percent, discount_reason, line_total, part_item_id, package_id, service_id, visible_to_customer, urgency, advisor_added, customer_approved, is_active, part_type, brand, option_group, chosen, fee_kind, recovery_trips, recovery_provider, dangerous";
export const SERVICE_SELECT = "id, category_id, name, department, price_aed, default_hours, description, parts_requests, position, is_active";
export const PART_SELECT = "id, job_id, part_request_id, part_number, description, quantity, diagram_path, supplier, cost_aed, availability, delivery_date, priced_by, priced_at, confirm_status, confirmed_quantity, confirmed_by, confirmed_at, reject_note, order_status, added_by_role, is_active, created_at, part_type, brand, option_group, question_text, question_at, question_by, answer_text, answered_at, answered_by";
export const REQUEST_SELECT = "id, job_id, inspection_id, source_type, source_key, label, requested_text, status, is_active, created_at, quantity, unit, closed_reason";

/** Numbers come back from Postgres as strings; the maths wants numbers. */
function num<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T {
  const out = { ...row };
  for (const k of keys) {
    const v = out[k];
    if (v !== null && v !== undefined && v !== "") (out as Record<string, unknown>)[k as string] = Number(v);
  }
  return out;
}
const LINE_NUM: (keyof QuoteLine)[] = ["position", "quantity", "unit_cost", "markup_percent", "unit_price", "hours", "labour_rate", "discount_percent", "line_total", "recovery_trips"];
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
/**
 * The approved quotations of a job that count for work, parts and the invoice: one per quotation
 * number, the newest approved version. An older approved version that was revised is not counted twice.
 */
export async function approvedQuotations(jobId: string): Promise<{ id: string; number: string; version: number; discount_percent: number; vat_percent: number; deposit_aed: number }[]> {
  const { data } = await createAdminClient().from("quotations").select("id, number, version, discount_percent, vat_percent, deposit_aed, created_at").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true).eq("status", "approved").order("created_at");
  const best = new Map<string, { id: string; number: string; version: number; discount_percent: number; vat_percent: number; deposit_aed: number }>();
  for (const q of (data ?? []) as { id: string; number: string; version: number | string; discount_percent: number | string; vat_percent: number | string; deposit_aed: number | string | null }[]) {
    const row = { id: q.id, number: q.number, version: Number(q.version) || 1, discount_percent: Number(q.discount_percent) || 0, vat_percent: Number(q.vat_percent) || 5, deposit_aed: Number(q.deposit_aed) || 0 };
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
  const [{ data: qs }, { data: parts }, { data: requests }] = await Promise.all([
    admin.from("quotations").select("id, job_id, number, version, status, token, sent_at, opened_at, responded_at, approver_name, total_aed, approved_total_aed, valid_until, promised_at, created_at, completed_at").in("job_id", jobIds).eq("is_active", true).neq("status", "superseded").order("created_at", { ascending: false }),
    admin.from("part_items").select("job_id, cost_aed, confirm_status").in("job_id", jobIds).eq("is_active", true),
    admin.from("part_requests").select("job_id, status").in("job_id", jobIds).eq("is_active", true),
  ]);
  for (const id of jobIds) out.set(id, { quotation: null, waitingPrices: 0, waitingConfirm: 0, rejectedParts: 0, openRequests: 0, partsTotal: 0, partsPriced: 0, labourTotal: 0, labourDone: 0 });
  for (const q of (qs ?? []) as ({ job_id: string } & Record<string, unknown>)[]) {
    const s = out.get(q.job_id)!;
    if (!s.quotation) s.quotation = toQuote(q) as QuoteSummary["quotation"];
  }
  for (const p of (parts ?? []) as { job_id: string; cost_aed: number | null; confirm_status: string }[]) {
    const s = out.get(p.job_id)!;
    if (p.confirm_status === "pending") s.waitingConfirm++;
    if (p.confirm_status === "rejected") s.rejectedParts++;
    else {
      s.partsTotal!++;
      if (p.cost_aed === null) s.waitingPrices++;
      else s.partsPriced!++;
    }
  }
  for (const r of (requests ?? []) as { job_id: string; status: string }[]) if (r.status === "open") out.get(r.job_id)!.openRequests++;
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
  const base = { quantity: 1, unit_cost: null, markup_percent: null, unit_price: null, hours: null, labour_rate: labourRate, discount_percent: 0, discount_reason: null, line_total: 0, part_item_id: null, package_id: null, service_id: null, visible_to_customer: true, urgency: null, advisor_added: false, customer_approved: null, part_type: null, brand: null, option_group: null, chosen: true, fee_kind: null, recovery_trips: null, recovery_provider: null, dangerous: false };
  for (const r of reqs ?? []) {
    const f = bundle.findings.find((x) => x.job_request_id === r.id);
    if (!f || !(f.status === "bad" || f.status === "average")) continue;
    // The labour line is the work on the complaint; what the technician listed as parts goes to Parts as a price request, never into the title.
    out.push({ ...base, position: position++, line_type: "labour", title: `Attend to: ${r.text}`, details: [f.found?.trim(), f.needs?.trim() ? `Needs: ${f.needs.trim()}` : ""].filter(Boolean).join(" · ") || null, group_label: `Request: ${r.text}`, source_type: "request", source_key: r.id });
  }
  for (const i of bundle.items) {
    if (!(i.status === "bad" || i.status === "average")) continue;
    // The title follows what the technician tapped: skim or replace a disc, repair a leak; a dangerous finding is Urgent from the start.
    const disc = DISC_ACTIONS.find((a) => a.value === i.disc_action);
    const leak = LEAK_REPAIRS.find((r) => r.value === i.leak_repair);
    const title = disc && i.disc_action === "skim" ? `Skim ${i.item_label.toLowerCase()}` : disc && i.disc_action === "replace" ? `Replace ${i.item_label.toLowerCase()}` : leak ? `${i.leak_repair === "replace" ? "Replace" : "Repair leak,"} ${i.item_label.toLowerCase()}${i.leak_repair === "replace" ? "" : ` (${leak.label.toLowerCase()})`}` : i.item_label;
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

export async function refreshQuoteTotals(quotationId: string, settings: Settings, by: string, opts: { reopen?: boolean } = {}) {
  const admin = createAdminClient();
  const [{ data: q }, { data: lines }] = await Promise.all([
    admin.from("quotations").select("id, discount_percent, vat_percent, status, completed_at").eq("id", quotationId).maybeSingle(),
    admin.from("quotation_lines").select(LINE_SELECT).eq("quotation_id", quotationId).eq("is_active", true),
  ]);
  if (!q) return;
  let ls = ((lines ?? []) as Record<string, unknown>[]).map(toLine);
  const stamp = by || null;
  const qArgs = { discount_percent: Number(q.discount_percent) || 0, vat_percent: Number(q.vat_percent) || 5 };
  // The automatic bank charge: one hidden Fee line at the set percentage of the total including VAT.
  // Never shown to the customer, counted as a cost against profit, corrected by the real charge at payment.
  if (q.status === "draft" || q.status === "pending_owner") {
    const feePercent = Number(settings.bank_charge_fee_percent) || 0;
    const others = ls.filter((l) => l.fee_kind !== "bank_charge");
    const fee = feePercent > 0 ? round2(quoteTotals(others, qArgs).total * (feePercent / 100)) : 0;
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
  const patch: Record<string, unknown> = { subtotal_aed: totals.subtotal, discount_aed: totals.discount, vat_aed: totals.vat, total_aed: totals.total, deposit_aed: totals.deposit, updated_by: stamp };
  if (responded) patch.approved_total_aed = quoteTotals(ls, qArgs, { onlyApproved: true }).total;
  // A change after "Quotation complete" reopens it: the advisor checks it again before sending.
  if (opts.reopen && q.completed_at) Object.assign(patch, { completed_at: null, completed_by: null });
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
  const [{ data: reqs }, { data: insp }] = await Promise.all([
    admin.from("part_requests").select("id").eq("job_id", jobId).eq("is_active", true).eq("status", "open"),
    admin.from("inspections").select("estimated_hours, estimated_hours_manager").eq("job_id", jobId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const hours = insp?.estimated_hours === null || insp?.estimated_hours === undefined ? null : Number(insp.estimated_hours);
  const managerHours = insp?.estimated_hours_manager === null || insp?.estimated_hours_manager === undefined ? null : Number(insp.estimated_hours_manager);
  return { openRequests: (reqs ?? []).length, workshopEstimate: hours === null ? null : { hours, managerHours, agreed: managerHours !== null } };
}

/** How long the advisor has been waiting on Parts: the oldest open request or unpriced part, in minutes, and who the Parts people are. */
export async function loadPartsWait(jobId: string): Promise<{ count: number; minutes: number; names: string[] }> {
  const admin = createAdminClient();
  const [{ data: reqs }, { data: parts }, { data: people }] = await Promise.all([
    admin.from("part_requests").select("created_at").eq("job_id", jobId).eq("is_active", true).eq("status", "open"),
    admin.from("part_items").select("created_at").eq("job_id", jobId).eq("is_active", true).neq("confirm_status", "rejected").is("cost_aed", null),
    admin.from("staff").select("display_name").eq("role_id", "parts").eq("is_active", true).order("display_name"),
  ]);
  const stamps = [...(reqs ?? []), ...(parts ?? [])].map((r) => Date.parse((r as { created_at: string }).created_at)).filter((t) => Number.isFinite(t));
  const minutes = stamps.length ? Math.max(0, Math.floor((Date.now() - Math.min(...stamps)) / 60000)) : 0;
  return { count: stamps.length, minutes, names: (people ?? []).map((p) => p.display_name as string) };
}

import { newLabelCode } from "@/lib/parts-data";
import "server-only";
import { randomBytes } from "node:crypto";
import { dubaiDate } from "./jobs";
import { round2 } from "./money";
import { notifyManagers, notifyRoles, notifyStaff } from "./notifications";
import { PART_FULL_SELECT, PO_LINE_SELECT, PO_SELECT, toPartFull, toPo, toPoLine, type PartFull, type PoLineRow, type PurchaseOrderRow } from "./parts-data";
import { createAdminClient } from "./supabase/admin";
import { attachChargesToPo, chargesByPo, moveChargesToSupplierPo, releaseCharges, type SupplierCharge } from "./supplier-charges";
import { releaseWords } from "./job-sides";
import { isOurStock, isPlaceholderSupplier, realPartNumber } from "./parts-rows";
import { costConfirmReady, schemaReady } from "./schema-ready";
import { lpoLineProblem, lpoProblemAdvice, type LpoProblem } from "./part-cost-check";
import { costChecksFor, type PartForCheck } from "./part-cost-history";

type Actor = { id: string; display_name: string };

/** One supplier's LPO with its lines, as the cards and the LPO page show it. */
export type SupplierLpoView = { po: PurchaseOrderRow; lines: PoLineRow[]; /** Courier, freight: "Other charges" rows, already in the LPO total. */ charges: SupplierCharge[] };
export type JobLpos = {
  /** The one LPO per job with every supplier, approved by the owner or the head accountant. */
  main: PurchaseOrderRow | null;
  mainLines: PoLineRow[];
  mainCharges: SupplierCharge[];
  /** One per supplier, made from the main one at approval (LPO-00012-1, -2, -3). */
  suppliers: SupplierLpoView[];
  /** Approved parts still to order that are on no LPO yet (a new approval after the main LPO, or nothing sent yet). */
  toOrder: PartFull[];
  /** Approved parts from our own stock (no LPO). */
  fromStock: PartFull[];
  /** Fix 2 (4 November 2026): the newest refused main LPO that has no replacement yet - shown with the owner's reason and "Send for approval again". */
  refused: { po: PurchaseOrderRow; lines: PoLineRow[]; reason: string } | null;
  /** Lines of the pending main LPO that changed AFTER it was sent for approval ("removed: PLUG WASHER"). */
  mainChanges: string[];
};

/** The owner's reason out of a refused LPO's notes ("Refused: too dear" → "too dear"). */
export function refusalReasonOf(notes: string | null): string {
  const line = String(notes ?? "").split("\n").find((l) => /refused/i.test(l)) ?? "";
  return line.replace(/^Refused:?\s*/i, "").trim();
}

/** The approved parts of a job: on an LPO, waiting for one, or from stock. */
export async function loadJobLpos(jobId: string): Promise<JobLpos> {
  const admin = createAdminClient();
  const [{ data: poRows }, { data: partRows }] = await Promise.all([
    admin.from("purchase_orders").select(PO_SELECT).eq("job_id", jobId).eq("is_active", true).neq("status", "cancelled").order("created_at"),
    admin.from("part_items").select(PART_FULL_SELECT).eq("job_id", jobId).eq("is_active", true).neq("order_status", "none"),
  ]);
  const pos = ((poRows ?? []) as Record<string, unknown>[]).map(toPo);
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull).filter((p) => p.return_status !== "returned");
  const { data: lineRows } = pos.length ? await admin.from("purchase_order_lines").select(PO_LINE_SELECT).in("po_id", pos.map((p) => p.id)).eq("is_active", true).order("position") : { data: [] };
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toPoLine);
  const main = [...pos].reverse().find((p) => p.kind === "main") ?? null;
  const charges = await chargesByPo(pos.map((p) => p.id));
  const suppliers = pos.filter((p) => p.kind === "supplier" && (!main || p.parent_id === main.id || !p.parent_id)).map((po) => ({ po, lines: lines.filter((l) => l.po_id === po.id), charges: charges.get(po.id) ?? [] }));
  // Fix 2 (4 November 2026): a refused main LPO is not a dead end. The newest one with no replacement is shown
  // with the owner's reason and "Send for approval again"; a pending main says what changed after it was sent.
  let refused: JobLpos["refused"] = null;
  if (!main || main.status !== "pending_approval") {
    const { data: ref } = await admin.from("purchase_orders").select(PO_SELECT).eq("job_id", jobId).eq("kind", "main").eq("status", "cancelled").eq("is_active", true).is("superseded_by", null).ilike("notes", "%refused%").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ref) {
      const po = toPo(ref as Record<string, unknown>);
      const { data: refLines } = await admin.from("purchase_order_lines").select(PO_LINE_SELECT).eq("po_id", po.id).order("position");
      refused = { po, lines: ((refLines ?? []) as Record<string, unknown>[]).map(toPoLine), reason: refusalReasonOf(po.notes) };
    }
  }
  const mainChanges: string[] = [];
  if (main && main.status === "pending_approval") {
    const { data: allLines } = await admin.from("purchase_order_lines").select("description, is_active, created_at, updated_at").eq("po_id", main.id).order("position");
    const sentAt = new Date(main.created_at).getTime();
    for (const l of allLines ?? []) {
      const name = String(l.description).toUpperCase();
      if (l.is_active === false) mainChanges.push(`removed: ${name}`);
      else if (new Date(l.created_at as string).getTime() > sentAt + 90_000) mainChanges.push(`added: ${name}`);
      else if (new Date(l.updated_at as string).getTime() > new Date(l.created_at as string).getTime() + 90_000) mainChanges.push(`changed: ${name}`);
    }
  }
  return {
    main,
    mainLines: main ? lines.filter((l) => l.po_id === main.id) : [],
    mainCharges: main ? charges.get(main.id) ?? [] : [],
    suppliers,
    refused,
    mainChanges,
    // Never a part marked not needed, or one refused on an LPO (its order status went back to none), and never a part
    // from our own shelf (2 November 2026: it is received from the shelf, never ordered - one stuck at To order no
    // longer blocks the job's LPO).
    toOrder: parts.filter((p) => p.order_status === "to_order" && !p.po_id && !p.not_needed_at && p.availability !== "in_stock" && !isOurStock(p.supplier)),
    fromStock: parts.filter((p) => p.availability === "in_stock"),
  };
}

/** Whole days the supplier gave at pricing: the delivery date minus the day it was priced (never below 0). */
export function leadDays(p: { delivery_date: string | null; priced_at: string | null; availability: string | null }): number | null {
  if (p.availability !== "to_order" || !p.delivery_date) return null;
  const pricedDay = p.priced_at ? new Date(new Date(p.priced_at).getTime() + 4 * 3600000).toISOString().slice(0, 10) : null;
  if (!pricedDay) return null;
  const days = Math.round((Date.parse(p.delivery_date) - Date.parse(pricedDay)) / 86400000);
  return Number.isFinite(days) ? Math.max(0, days) : null;
}

/** The arrival date when a part is ordered today: the lead time from pricing counted from the order day. */
export function expectedDateFor(p: { delivery_date: string | null; priced_at: string | null; availability: string | null }, orderDay = dubaiDate()): string | null {
  const days = leadDays(p);
  if (days === null) return p.delivery_date && p.delivery_date >= orderDay ? p.delivery_date : null;
  return new Date(Date.parse(orderDay) + days * 86400000).toISOString().slice(0, 10);
}

/**
 * THE LPO gate of a job's parts (2 November 2026, 2.2): a real cost before a part is ever ordered - a price, a real
 * supplier (never "OFJ Additional"), never from our stock, never AED 1.00 unless Parts confirmed it, and no cost
 * question waiting. What stops each part, by part id, with what fixes it (lpoLineProblem in part-cost-check.ts).
 */
export async function lpoProblemsFor(jobId: string, partIds: string[]): Promise<Map<string, LpoProblem>> {
  const out = new Map<string, LpoProblem>();
  if (!partIds.length) return out;
  const ready = await costConfirmReady();
  const { data } = await createAdminClient().from("part_items").select(`id, job_id, description, part_number, part_type, option_group, cost_aed, final_cost_aed, order_status, list_price_aed, discount_percent, supplier, availability, stock_item_id, is_active, removed_at, confirm_status${ready ? ", cost_confirmed_aed" : ""}`).eq("job_id", jobId).eq("is_active", true);
  const all = (data ?? []) as unknown as (PartForCheck & { availability: string | null })[];
  const mine = all.filter((p) => partIds.includes(p.id));
  const checks = await costChecksFor(mine, all);
  for (const p of mine) {
    const c = checks.get(p.id);
    const problem = lpoLineProblem({ description: p.description, cost_aed: p.cost_aed === null ? null : Number(p.cost_aed), supplier: p.supplier, availability: p.availability }, { ask: c?.ask ?? null, hold: !!c?.hold, confirmed: !!c?.confirmed });
    if (problem) out.set(p.id, problem);
  }
  return out;
}

/** "1 part cannot go on an LPO yet: …" with what to do: a question Parts can answer is never sent the replace way. */
export function lpoProblemWords(problems: Map<string, LpoProblem>, approving = false): string {
  const n = problems.size;
  const all = Array.from(problems.values());
  const list = all.map((p) => p.words).join("; ");
  return approving
    ? `Not approved: ${n} line${n === 1 ? " has" : "s have"} no real price (${list}). ${lpoProblemAdvice(all, true)}`
    : `${n} part${n === 1 ? "" : "s"} cannot go on an LPO yet: ${list}. ${lpoProblemAdvice(all, false)}`;
}

const lineOf = (p: PartFull, i: number) => ({ part_item_id: p.id, position: i + 1, description: p.description, part_number: realPartNumber(p.part_number), quantity: Number(p.confirmed_quantity ?? p.quantity) || 1, unit_cost: p.cost_aed ?? 0, list_price: p.list_price_aed ?? null, discount_percent: p.discount_percent ?? null });

/**
 * "Send LPO for approval": the one main LPO for the job with every approved part still to order, whatever the
 * supplier. It waits for the owner or the head accountant. Parts from our own stock never go on it.
 */
export async function createMainLpo(jobId: string, by: Actor): Promise<{ error?: string; poId?: string; number?: string }> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, is_open, status").eq("id", jobId).maybeSingle();
  // Part 4 (4 November 2026): a HELD job ("Order parts now" before the car arrives) is booked, not open —
  // its LPO is raised exactly like any other and gate-in opens the job itself.
  if (!job || (!job.is_open && job.status !== "booked")) return { error: "This job is closed." };
  const { toOrder, main } = await loadJobLpos(jobId);
  if (main && main.status === "pending_approval") return { error: `${main.number} is already waiting for approval.` };
  if (!toOrder.length) return { error: "Nothing to order: every approved part is from stock or already on an LPO." };
  // A real cost before anything is ordered (2.2): nothing is sent while one line has no real price.
  const problems = await lpoProblemsFor(jobId, toOrder.map((p) => p.id));
  if (problems.size) return { error: lpoProblemWords(problems) };
  const lines = toOrder.map(lineOf);
  const total = round2(lines.reduce((a, l) => a + l.quantity * l.unit_cost, 0));
  const supplierNames = Array.from(new Set(toOrder.map((p) => (p.supplier ?? "").trim()).filter(Boolean)));
  const { data: po, error } = await admin.from("purchase_orders").insert({ job_id: jobId, kind: "main", supplier_id: null, supplier_name: supplierNames.length === 1 ? supplierNames[0] : `${supplierNames.length} suppliers`, total_cost_aed: total, verify_token: randomBytes(18).toString("hex"), created_by: by.id, updated_by: by.id }).select("id, number").single();
  if (error || !po) return { error: error?.message ?? "Could not raise the LPO." };
  const { data: created } = await admin.from("purchase_order_lines").insert(lines.map((l) => ({ ...l, po_id: po.id, created_by: by.id, updated_by: by.id }))).select("id, part_item_id");
  for (const l of created ?? []) await admin.from("part_items").update({ po_id: po.id, po_line_id: l.id, updated_by: by.id }).eq("id", l.part_item_id);
  // The suppliers' charges (courier, freight) ride on the LPO as "Other charges": the total includes them.
  const extra = await attachChargesToPo(jobId, po.id, supplierNames, by.id);
  const grand = round2(total + extra);
  if (extra) await admin.from("purchase_orders").update({ total_cost_aed: grand, updated_by: by.id }).eq("id", po.id);
  await admin.from("jobs").update({ parts_state: "ordering" }).eq("id", jobId).eq("parts_state", "none");
  await admin.from("job_events").insert({ job_id: jobId, event_type: "po_raised", note: `${po.number} sent for approval by ${by.display_name}: ${lines.length} part${lines.length === 1 ? "" : "s"} from ${supplierNames.join(", ")}${extra ? ` + supplier charges AED ${extra.toLocaleString("en-GB")}` : ""}, AED ${grand.toLocaleString("en-GB")}`, created_by: by.id });
  const n = { type: "po_approval", title: `LPO to approve · ${po.number}`, body: `${job.job_number} · ${supplierNames.join(", ")} · AED ${grand.toLocaleString("en-GB")} · from ${by.display_name}. One tap to approve.`, jobId, href: `/parts/orders/${po.id}` };
  const { data: heads } = await admin.from("staff").select("id").eq("role_id", "accounts").eq("is_head_accountant", true).eq("is_active", true);
  await notifyRoles(["owner"], n);
  await notifyStaff((heads ?? []).map((h) => h.id), n);
  return { poId: po.id, number: po.number };
}

/**
 * At approval the main LPO is split into one LPO per supplier (LPO-00012-1, -2, -3), each with only that
 * supplier's parts. The parts point at their supplier LPO from here on; receiving happens there.
 */
export async function splitMainLpo(mainId: string, by: Actor): Promise<{ created: { id: string; number: string; supplier: string }[] }> {
  const admin = createAdminClient();
  const { data: raw } = await admin.from("purchase_orders").select(PO_SELECT).eq("id", mainId).maybeSingle();
  if (!raw) return { created: [] };
  const main = toPo(raw as Record<string, unknown>);
  const { data: partRows } = await admin.from("part_items").select(PART_FULL_SELECT).eq("po_id", mainId).eq("is_active", true);
  const parts = ((partRows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull);
  const groups = new Map<string, PartFull[]>();
  for (const p of parts) {
    // Never "Our stock" or a stand-in supplier as an LPO's supplier (the gate stops them before approval).
    const raw = (p.supplier ?? "").trim();
    const key = raw && !isOurStock(raw) && !isPlaceholderSupplier(raw) ? raw : "Supplier to confirm";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const { data: existing } = await admin.from("purchase_orders").select("sub_number").eq("parent_id", mainId);
  let next = Math.max(0, ...(existing ?? []).map((e) => Number(e.sub_number) || 0));
  const created: { id: string; number: string; supplier: string }[] = [];
  for (const [supplierName, items] of groups) {
    next++;
    const { data: sup } = await admin.from("suppliers").select("id").ilike("name", supplierName).maybeSingle();
    let supplierId = sup?.id ?? null;
    // A supplier row is made for a real supplier only, never for "Supplier to confirm".
    if (!supplierId && supplierName !== "Supplier to confirm") {
      const { data: made } = await admin.from("suppliers").insert({ name: supplierName, created_by: by.id, updated_by: by.id }).select("id").single();
      supplierId = made?.id ?? null;
    }
    const lines = items.map(lineOf);
    const total = round2(lines.reduce((a, l) => a + l.quantity * l.unit_cost, 0));
    const { data: po } = await admin.from("purchase_orders").insert({ job_id: main.job_id, kind: "supplier", parent_id: mainId, sub_number: next, number: `${main.number}-${next}`, supplier_id: supplierId, supplier_name: supplierName, status: "approved", approved_by: main.approved_by, approved_at: main.approved_at, deposit_override_by: main.deposit_override_by, deposit_override_reason: main.deposit_override_reason, total_cost_aed: total, verify_token: randomBytes(18).toString("hex"), created_by: by.id, updated_by: by.id }).select("id, number").single();
    if (!po) continue;
    const { data: made } = await admin.from("purchase_order_lines").insert(lines.map((l) => ({ ...l, po_id: po.id, created_by: by.id, updated_by: by.id }))).select("id, part_item_id");
    for (const l of made ?? []) await admin.from("part_items").update({ po_id: po.id, po_line_id: l.id, updated_by: by.id }).eq("id", l.part_item_id);
    const extra = await moveChargesToSupplierPo(mainId, supplierName, po.id, by.id);
    if (extra) await admin.from("purchase_orders").update({ total_cost_aed: round2(total + extra), updated_by: by.id }).eq("id", po.id);
    created.push({ id: po.id, number: po.number, supplier: supplierName });
  }
  return { created };
}

/**
 * "Ordered" on a supplier LPO: one tap. Every line's arrival date follows from the availability entered at
 * pricing, counted from today; a part with no lead time keeps no date until someone sets it with a tap.
 */
export async function orderSupplierLpo(poId: string, by: Actor): Promise<{ error?: string; latest?: string | null; number?: string }> {
  const admin = createAdminClient();
  const [{ data: raw }, { data: lineRows }] = await Promise.all([admin.from("purchase_orders").select(PO_SELECT).eq("id", poId).maybeSingle(), admin.from("purchase_order_lines").select(PO_LINE_SELECT).eq("po_id", poId).eq("is_active", true)]);
  if (!raw) return { error: "LPO not found." };
  const po = toPo(raw as Record<string, unknown>);
  if (po.status === "pending_approval") return { error: "Not approved yet." };
  if (po.status !== "approved") return { error: "This order was already placed." };
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map(toPoLine);
  const partIds = lines.map((l) => l.part_item_id).filter((x): x is string => !!x);
  const { data: partRows } = partIds.length ? await admin.from("part_items").select(PART_FULL_SELECT).in("id", partIds) : { data: [] as Record<string, unknown>[] };
  const parts = new Map(((partRows ?? []) as unknown as Record<string, unknown>[]).map(toPartFull).map((p) => [p.id, p]));
  const today = dubaiDate();
  const dates: string[] = [];
  for (const l of lines) {
    const p = l.part_item_id ? parts.get(l.part_item_id) : undefined;
    const expected = p ? expectedDateFor(p, today) : null;
    if (expected) dates.push(expected);
    await admin.from("purchase_order_lines").update({ expected_date: expected, updated_by: by.id }).eq("id", l.id);
    if (l.part_item_id) await admin.from("part_items").update({ order_status: "ordered", expected_date: expected, ...(expected ? { delivery_date: expected } : {}), updated_by: by.id }).eq("id", l.part_item_id);
  }
  const now = new Date().toISOString();
  await admin.from("purchase_orders").update({ status: "ordered", ordered_at: now, ordered_by: by.id, sent_at: po.sent_at ?? now, sent_by: po.sent_by ?? by.id, sent_method: po.sent_method ?? "ordered", updated_by: by.id }).eq("id", poId);
  const latest = dates.sort().at(-1) ?? null;
  if (po.job_id) {
    await admin.from("jobs").update({ parts_state: "ordered" }).eq("id", po.job_id).in("parts_state", ["none", "ordering"]);
    await admin.from("job_events").insert({ job_id: po.job_id, event_type: "po_ordered", note: `${po.number} ordered from ${po.supplier_name} by ${by.display_name}${latest ? `; expected by ${latest}` : ""}`, created_by: by.id });
    await finishPartsPlanning(po.job_id, by);
  }
  return { latest, number: po.number };
}

/** A part's arrival date changed with a tap (the supplier said otherwise). The job's "all parts here by" follows. */
export async function setPartExpected(partId: string, date: string, by: Actor): Promise<{ error?: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the date." };
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, po_line_id, description").eq("id", partId).maybeSingle();
  if (!p) return { error: "Part not found." };
  await admin.from("part_items").update({ expected_date: date, delivery_date: date, updated_by: by.id }).eq("id", partId);
  if (p.po_line_id) await admin.from("purchase_order_lines").update({ expected_date: date, updated_by: by.id }).eq("id", p.po_line_id);
  await admin.from("job_events").insert({ job_id: p.job_id, event_type: "po_ordered", note: `${p.description}: expected ${date} (changed by ${by.display_name})`, created_by: by.id });
  await finishPartsPlanning(p.job_id, by, { quiet: true });
  return {};
}

/**
 * The Parts step of the planning is done when nothing is left to order: every approved part is from stock,
 * or ordered with its date. The job shows "All parts here by …" and the workshop manager plans the work.
 */
export async function finishPartsPlanning(jobId: string, by: Actor | null, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, status, is_open, department, plan_parts_done_at, plan_parts_ready_date, plan_released_at").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return false;
  const { toOrder, main, suppliers, fromStock } = await loadJobLpos(jobId);
  if (toOrder.length || (main && main.status === "pending_approval") || suppliers.some((s) => s.po.status === "approved")) return false;
  const { data: partRows } = await admin.from("part_items").select("expected_date, delivery_date, order_status, availability, received_qty, quantity, confirmed_quantity").eq("job_id", jobId).eq("is_active", true).neq("order_status", "none").neq("return_status", "returned");
  const missing = (partRows ?? []).filter((p) => p.order_status !== "received" && p.availability !== "in_stock");
  const dates = missing.map((p) => (p.expected_date as string | null) ?? (p.delivery_date as string | null)).filter((d): d is string => !!d).sort();
  const today = dubaiDate();
  const ready = missing.length === 0 ? today : (dates.at(-1) ?? null);
  const changed = job.plan_parts_ready_date !== ready || !job.plan_parts_done_at;
  if (!changed) return true;
  const firstTime = !job.plan_parts_done_at;
  await admin.from("jobs").update({ ...(["approved", "waiting_parts"].includes(job.status) ? { status: "waiting_parts", stage: "parts" } : {}), plan_parts_done_at: job.plan_parts_done_at ?? new Date().toISOString(), plan_parts_by: by?.id ?? null, plan_parts_ready_date: ready }).eq("id", jobId);
  const text = missing.length ? (ready ? `All parts here by ${ready}` : "Ordered, dates to follow") : fromStock.length || (partRows ?? []).length ? "Every part is here" : "No parts needed";
  await admin.from("job_events").insert({ job_id: jobId, event_type: "planning", note: `${text}${by ? ` (${by.display_name})` : ""}`, created_by: by?.id ?? null });
  if (!opts.quiet || firstTime) {
    if (!job.plan_released_at) await notifyManagers(job.department ?? null, { type: "planning", title: `Plan the work · ${job.job_number}`, body: `${text}. ${releaseWords(job.department)}`, jobId, href: `/jobs/${jobId}#planning` });
  }
  return true;
}

/**
 * "Received" with one tap on the parts page: the part's LPO line is received in full and the part is ready to hand over.
 * Partial deliveries and wrong or damaged parts stay on the LPO page. When the last ordered part is in, the manager and
 * the advisor hear.
 */
export async function receivePartInFull(partId: string, by: Actor): Promise<{ error?: string; complete?: boolean }> {
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, description, po_id, order_status, quantity, confirmed_quantity, received_qty, label_code").eq("id", partId).maybeSingle();
  if (!p) return { error: "Part not found." };
  if (!["ordered", "partly_received"].includes(String(p.order_status))) return { error: "This part is not on order." };
  const qty = Number(p.confirmed_quantity ?? p.quantity) || 1;
  const now = new Date().toISOString();
  const { data: line } = p.po_id ? await admin.from("purchase_order_lines").select("id, po_id, quantity").eq("po_id", p.po_id).eq("part_item_id", p.id).eq("is_active", true).maybeSingle() : { data: null };
  if (line) await admin.from("purchase_order_lines").update({ received_qty: line.quantity, received_at: now, updated_by: by.id }).eq("id", line.id);
  await admin.from("part_items").update({ received_qty: qty, order_status: "received", label_code: p.label_code ?? newLabelCode(), updated_by: by.id }).eq("id", p.id);
  if (line) {
    const { data: after } = await admin.from("purchase_order_lines").select("quantity, received_qty").eq("po_id", line.po_id).eq("is_active", true);
    const allIn = (after ?? []).every((l) => Number(l.received_qty) + 0.005 >= Number(l.quantity));
    await admin.from("purchase_orders").update({ status: allIn ? "received" : "partly_received", received_at: allIn ? now : null, updated_by: by.id }).eq("id", line.po_id);
  }
  const { data: open } = await admin.from("part_items").select("id").eq("job_id", p.job_id).eq("is_active", true).in("order_status", ["to_order", "ordered", "partly_received"]);
  const complete = (open ?? []).length === 0;
  if (complete) await admin.from("jobs").update({ parts_state: "received" }).eq("id", p.job_id);
  await admin.from("job_events").insert({ job_id: p.job_id, event_type: "parts_received", note: `${p.description} received (${by.display_name})${complete ? " · every part is in" : ""}`, created_by: by.id });
  if (complete) {
    const { data: job } = await admin.from("jobs").select("job_number, department, gated_in_by").eq("id", p.job_id).maybeSingle();
    const n = { type: "parts_arrived", title: `All parts in · ${job?.job_number ?? ""}`, body: "Every ordered part has arrived. Hand them over to the technician.", jobId: p.job_id as string, href: `/parts/handover/${p.job_id}` };
    await notifyManagers(job?.department ?? null, n);
    if (job?.gated_in_by) await notifyStaff([job.gated_in_by], n);
  }
  return { complete };
}

/** Migration 20261202110000_lpo_refusals_intake: a part line refused on its own on an LPO waiting for approval. */
export const refusalsReady = () => schemaReady("part_items", "refused_at, refused_by, refused_reason, refused_po_id");

/** "1 part added", "2 parts added". */
const partsWord = (n: number) => `${n} part${n === 1 ? "" : "s"}`;

/** The owner and the head accountants (exported for the ending path: Fix 2.3, 4 November 2026). */
export async function lpoApproverIds(): Promise<string[]> {
  return approverIds();
}

/** The owner and the head accountants: who approve LPOs. */
async function approverIds(): Promise<string[]> {
  const { data } = await createAdminClient().from("staff").select("id, role_id, is_head_accountant").eq("is_active", true).in("role_id", ["owner", "accounts"]);
  return (data ?? []).filter((s) => s.role_id === "owner" || s.is_head_accountant).map((s) => s.id as string);
}

/** A main LPO's total and its supplier words, after lines came or went. */
async function retotalPo(poId: string, by: string): Promise<{ total: number; lines: number; suppliers: string[] }> {
  const admin = createAdminClient();
  const { data: lines } = await admin.from("purchase_order_lines").select("quantity, unit_cost, part_item_id").eq("po_id", poId).eq("is_active", true);
  const partIds = (lines ?? []).map((l) => l.part_item_id).filter((x): x is string => !!x);
  const { data: parts } = partIds.length ? await admin.from("part_items").select("supplier").in("id", partIds) : { data: [] };
  const suppliers = Array.from(new Set((parts ?? []).map((p) => String(p.supplier ?? "").trim()).filter(Boolean)));
  const charges = (await chargesByPo([poId])).get(poId) ?? [];
  const total = round2((lines ?? []).reduce((a, l) => a + Number(l.quantity) * Number(l.unit_cost), 0) + charges.reduce((a, c) => a + c.amount_aed, 0));
  await admin.from("purchase_orders").update({ total_cost_aed: total, supplier_name: suppliers.length === 1 ? suppliers[0] : `${suppliers.length} suppliers`, updated_by: by }).eq("id", poId);
  return { total, lines: (lines ?? []).length, suppliers };
}

const aedText = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Nothing priced and marked To order is ever left out of an LPO silently (1 November 2026, LPO-00038). Once a job has
 * a main LPO, every approved part that is priced, to order from a supplier and on no LPO yet goes:
 *   - onto the main LPO while it still waits for approval (its supplier gets its own section, the total moves, and the
 *     owner and the head accountant hear "1 part added to LPO-00038");
 *   - onto a NEW LPO for approval when the main one was already approved.
 * Before the first LPO, the desk's "Send LPO for approval" stays the step.
 */
export async function addPartsToOpenLpo(jobId: string, by: Actor): Promise<{ added: number; number?: string; created?: boolean }> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, is_open").eq("id", jobId).maybeSingle();
  if (!job?.is_open) return { added: 0 };
  const { toOrder, main } = await loadJobLpos(jobId);
  if (!main) return { added: 0 };
  const open = toOrder.filter((p) => p.availability !== "in_stock" && !isOurStock(p.supplier) && !p.not_needed_at);
  // Only a part with a real cost joins an LPO (2.2): the others wait in the table until their price is real.
  const problems = await lpoProblemsFor(jobId, open.map((p) => p.id));
  const ready = open.filter((p) => !problems.has(p.id));
  if (!ready.length) return { added: 0 };
  if (main.status !== "pending_approval") {
    // Already approved: the added parts get their own approval request (once every one of them is priced).
    if (ready.length !== open.length) return { added: 0 };
    const r = await createMainLpo(jobId, by);
    if (r.error || !r.number) return { added: 0 };
    return { added: ready.length, number: r.number, created: true };
  }
  const { data: last } = await admin.from("purchase_order_lines").select("position").eq("po_id", main.id).order("position", { ascending: false }).limit(1).maybeSingle();
  const start = Number(last?.position) || 0;
  const rows = ready.map((p, i) => ({ ...lineOf(p, start + i), part_number: realPartNumber(p.part_number) }));
  const { data: made } = await admin.from("purchase_order_lines").insert(rows.map((l) => ({ ...l, po_id: main.id, created_by: by.id, updated_by: by.id }))).select("id, part_item_id");
  for (const l of made ?? []) await admin.from("part_items").update({ po_id: main.id, po_line_id: l.id, updated_by: by.id }).eq("id", l.part_item_id);
  const newSuppliers = Array.from(new Set(ready.map((p) => (p.supplier ?? "").trim()).filter(Boolean)));
  await attachChargesToPo(jobId, main.id, newSuppliers, by.id);
  const t = await retotalPo(main.id, by.id);
  const what = ready.map((p) => `${p.description.toUpperCase()} (${(p.supplier ?? "").trim()}, ${aedText(round2((p.cost_aed ?? 0) * (Number(p.confirmed_quantity ?? p.quantity) || 1)))})`).join(", ");
  await admin.from("job_events").insert({ job_id: jobId, event_type: "po_part_added", note: `${main.number}: ${partsWord(ready.length)} added while it waits for approval (${by.display_name}): ${what}. New total ${aedText(t.total)}.`, created_by: by.id });
  await notifyStaff(await approverIds(), { type: "po_approval", title: `${partsWord(ready.length)} added to ${main.number}`, body: `${job.job_number} · ${what}. New total ${aedText(t.total)}. One tap to approve.`, jobId, href: `/parts/orders/${main.id}` });
  return { added: ready.length, number: main.number };
}

/**
 * A part whose price, quantity or supplier changed while it sits on a main LPO still waiting for approval: its line
 * follows, the total moves, and the approvers are told. Approved LPOs are never touched here.
 */
export async function refreshPendingLpoLine(partId: string, by: Actor): Promise<void> {
  const admin = createAdminClient();
  const { data: p } = await admin.from("part_items").select("id, job_id, po_id, po_line_id, description, part_number, quantity, confirmed_quantity, cost_aed, list_price_aed, discount_percent, supplier").eq("id", partId).maybeSingle();
  if (!p?.po_id || !p.po_line_id) return;
  const { data: po } = await admin.from("purchase_orders").select("id, number, status, kind").eq("id", p.po_id).maybeSingle();
  if (!po || po.status !== "pending_approval" || po.kind !== "main") return;
  // The line follows the part; when its cost is no longer real the approvers are told to refuse it (2.2).
  const problem = (await lpoProblemsFor(p.job_id, [p.id])).get(p.id) ?? null;
  const { data: line } = await admin.from("purchase_order_lines").select("quantity, unit_cost, description, part_number").eq("id", p.po_line_id).maybeSingle();
  if (!line) return;
  const qty = Number(p.confirmed_quantity ?? p.quantity) || 1;
  const cost = Number(p.cost_aed ?? 0);
  const pn = realPartNumber(p.part_number);
  if (Math.abs(Number(line.quantity) - qty) < 0.001 && Math.abs(Number(line.unit_cost) - cost) < 0.005 && line.description === p.description && (line.part_number ?? null) === pn) return;
  await admin.from("purchase_order_lines").update({ quantity: qty, unit_cost: cost, list_price: p.list_price_aed, discount_percent: p.discount_percent, description: p.description, part_number: pn, updated_by: by.id }).eq("id", p.po_line_id);
  const t = await retotalPo(po.id, by.id);
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", p.job_id).maybeSingle();
  const part = String(p.description).toUpperCase();
  await admin.from("job_events").insert({ job_id: p.job_id, event_type: "po_part_changed", note: `${po.number}: ${part} changed (${by.display_name}): × ${qty} at AED ${cost.toFixed(2)}, ${p.supplier ?? ""}. New total ${aedText(t.total)}.`, created_by: by.id });
  await notifyStaff(await approverIds(), { type: "po_approval", title: `${po.number} changed: ${part}`, body: `${job?.job_number ?? ""} · × ${qty} at AED ${cost.toFixed(2)} from ${p.supplier ?? "?"}. New total ${aedText(t.total)}.${problem ? ` NOT A REAL PRICE YET: ${problem.words}. ${lpoProblemAdvice([problem], true)}` : ""}`, jobId: p.job_id, href: `/parts/orders/${po.id}` });
}

/**
 * The owner or the head accountant refuses ONE line of an LPO waiting for approval: the part is greyed "Refused by
 * <name> – <reason>", never To order and never on an LPO again; Parts are told to add a replacement. The rest of the
 * LPO keeps waiting; refusing the last line cancels it.
 */
export async function refusePoLine(poId: string, lineId: string, reason: string, by: Actor): Promise<{ error?: string; number?: string; cancelled?: boolean; part?: string }> {
  if (!(await refusalsReady())) return { error: "Refusing one line needs the database update first (waiting for apply). Refuse the whole LPO for now." };
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("id, number, status, job_id, notes").eq("id", poId).maybeSingle();
  if (!po) return { error: "LPO not found." };
  if (po.status !== "pending_approval") return { error: `${po.number} is no longer waiting for approval.` };
  const { data: line } = await admin.from("purchase_order_lines").select("id, part_item_id, description").eq("id", lineId).eq("po_id", poId).eq("is_active", true).maybeSingle();
  if (!line) return { error: "That line is no longer on the LPO." };
  const now = new Date().toISOString();
  await admin.from("purchase_order_lines").update({ is_active: false, updated_by: by.id }).eq("id", lineId);
  let supplier = "";
  if (line.part_item_id) {
    const { data: part } = await admin.from("part_items").select("supplier").eq("id", line.part_item_id).maybeSingle();
    supplier = String(part?.supplier ?? "").trim();
    await admin.from("part_items").update({ po_id: null, po_line_id: null, order_status: "none", refused_at: now, refused_by: by.id, refused_reason: reason, refused_po_id: poId, updated_by: by.id }).eq("id", line.part_item_id);
  }
  let t = await retotalPo(poId, by.id);
  let cancelled = false;
  if (!t.lines) {
    cancelled = true;
    await admin.from("purchase_orders").update({ status: "cancelled", notes: [po.notes, "Every line refused"].filter(Boolean).join("\n"), updated_by: by.id }).eq("id", poId);
    await releaseCharges(poId, by.id);
  } else if (supplier && !t.suppliers.some((s) => s.toLowerCase() === supplier.toLowerCase())) {
    // That supplier has no line left here: its courier or freight charge leaves with it.
    const { data: ch } = await admin.from("supplier_charges").select("id, supplier_name").eq("po_id", poId).eq("is_active", true);
    const gone = (ch ?? []).filter((c) => String(c.supplier_name ?? "").trim().toLowerCase() === supplier.toLowerCase()).map((c) => c.id as string);
    if (gone.length) {
      await admin.from("supplier_charges").update({ po_id: null, updated_by: by.id }).in("id", gone);
      t = await retotalPo(poId, by.id);
    }
  }
  const part = String(line.description).toUpperCase();
  if (po.job_id) {
    await admin.from("job_events").insert({ job_id: po.job_id, event_type: "po_line_refused", note: `${po.number}: ${part}${supplier ? ` (${supplier})` : ""} refused by ${by.display_name}: ${reason}${cancelled ? `. Every line refused: ${po.number} cancelled.` : `. New total ${aedText(t.total)}.`}`, created_by: by.id });
    await notifyRoles(["parts"], { type: "po_decided", title: `Refused on ${po.number}: ${part}`, body: `${by.display_name}: ${reason}. ${supplier ? `${supplier} is off the LPO. ` : ""}Tap Replace on the line to add a replacement${cancelled ? "" : "; it joins the LPO waiting for approval by itself"}.`, jobId: po.job_id, href: `/parts/${po.job_id}` });
  }
  return { number: po.number, cancelled, part };
}

/* ------------------------------------------------------------------------------------------------------------------
 * Fix 2 of 4 November 2026: a refused LPO is never a dead end, and a pending approval always shows the current list.
 * ---------------------------------------------------------------------------------------------------------------- */

type DiffLine = { description: string; part_number?: string | null; quantity: number; unit_cost: number };

/** What changed between the refused list and the new one, in plain words, for the owner's approval page and bell. */
export function lpoDiff(oldLines: DiffLine[], newLines: DiffLine[]): { added: string[]; removed: string[]; changed: string[] } {
  const keyOf = (l: DiffLine) => String(l.description).trim().toUpperCase();
  const olds = new Map(oldLines.map((l) => [keyOf(l), l]));
  const news = new Map(newLines.map((l) => [keyOf(l), l]));
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [k, l] of news) {
    const was = olds.get(k);
    if (!was) added.push(k);
    else if (Math.abs(Number(was.quantity) - Number(l.quantity)) > 0.001 || Math.abs(Number(was.unit_cost) - Number(l.unit_cost)) > 0.005) {
      changed.push(`${k} (was × ${Number(was.quantity)} at AED ${Number(was.unit_cost).toFixed(2)}, now × ${Number(l.quantity)} at AED ${Number(l.unit_cost).toFixed(2)})`);
    }
  }
  for (const k of olds.keys()) if (!news.has(k)) removed.push(k);
  return { added, removed, changed };
}

export const diffWords = (d: { added: string[]; removed: string[]; changed: string[] }): string =>
  [d.added.length ? `added ${d.added.join(", ")}` : "", d.removed.length ? `removed ${d.removed.join(", ")}` : "", d.changed.length ? `changed ${d.changed.join("; ")}` : ""].filter(Boolean).join(" · ") || "same parts, same prices";

/**
 * "Send for approval again" on a refused main LPO: a NEW version is raised from the CURRENT list (Peter's removals,
 * replacements and additions applied), numbered after the refused one ("LPO-00041 V2"), and the owner sees what
 * changed against the refused list, highlighted. The refused LPO is put away (superseded) so it stops showing.
 */
export async function resendMainLpo(refusedPoId: string, by: Actor): Promise<{ error?: string; poId?: string; number?: string }> {
  const admin = createAdminClient();
  const { data: old } = await admin.from("purchase_orders").select("id, number, job_id, kind, status, notes, superseded_by").eq("id", refusedPoId).maybeSingle();
  if (!old || old.kind !== "main") return { error: "LPO not found." };
  if (old.status !== "cancelled" || !/refused/i.test(String(old.notes ?? ""))) return { error: `${old.number} was not refused: nothing to send again.` };
  if (old.superseded_by) return { error: `${old.number} was already sent again.` };
  const r = await createMainLpo(old.job_id, by);
  if (r.error || !r.poId) return { error: r.error ?? "Could not raise the new LPO." };
  // The new version carries the refused LPO's own number with V2, V3 … so everyone talks about the same order.
  const base = String(old.number).replace(/ V\d+$/i, "");
  const { data: priors } = await admin.from("purchase_orders").select("number").eq("job_id", old.job_id).or(`number.eq.${base},number.like.${base} V%`);
  const version = Math.max(1, ...(priors ?? []).map((p) => (String(p.number) === base ? 1 : Number(/ V(\d+)$/i.exec(String(p.number))?.[1]) || 1))) + 1;
  const newNumber = `${base} V${version}`;
  const { error: numErr } = await admin.from("purchase_orders").update({ number: newNumber, updated_by: by.id }).eq("id", r.poId);
  const finalNumber = numErr ? r.number ?? newNumber : newNumber;
  await admin.from("purchase_orders").update({ superseded_by: r.poId, updated_by: by.id }).eq("id", refusedPoId);
  // What changed against the refused list, for the owner.
  const [{ data: oldLines }, { data: newLines }] = await Promise.all([
    // The refused list as the owner SAW it: lines cut before the refusal are not "changes" of the new version.
    admin.from("purchase_order_lines").select("description, quantity, unit_cost").eq("po_id", refusedPoId).eq("is_active", true),
    admin.from("purchase_order_lines").select("description, quantity, unit_cost").eq("po_id", r.poId).eq("is_active", true),
  ]);
  const words = diffWords(lpoDiff((oldLines ?? []) as DiffLine[], (newLines ?? []) as DiffLine[]));
  const { data: job } = await admin.from("jobs").select("job_number").eq("id", old.job_id).maybeSingle();
  await admin.from("job_events").insert({ job_id: old.job_id, event_type: "po_resent", note: `${finalNumber} sent for approval again by ${by.display_name} after ${old.number} was refused. Changes: ${words}.`, created_by: by.id });
  await notifyStaff(await approverIds(), { type: "po_approval", title: `${finalNumber} to approve (sent again after refusal)`, body: `${job?.job_number ?? ""} · replaces the refused ${old.number}. Changes: ${words}. One tap to approve.`, jobId: old.job_id, href: `/parts/orders/${r.poId}` });
  return { poId: r.poId, number: finalNumber };
}

/**
 * A part deleted or removed while it sits on a main LPO still WAITING for approval: its line comes off that LPO at
 * once, the total moves, and the approvers are told - the owner never approves a list that is no longer true.
 * Approved and ordered LPOs are never touched here (an ordered part leaves through its ending instead).
 */
export async function cutPendingLpoLines(jobId: string, partIds: string[], by: Actor, what: string): Promise<void> {
  if (!partIds.length) return;
  const admin = createAdminClient();
  const { data: parts } = await admin.from("part_items").select("id, description, po_id, po_line_id").in("id", partIds).not("po_id", "is", null);
  const withPo = (parts ?? []).filter((p) => p.po_line_id);
  if (!withPo.length) return;
  const poIds = Array.from(new Set(withPo.map((p) => p.po_id as string)));
  const { data: pos } = await admin.from("purchase_orders").select("id, number, status, kind").in("id", poIds).eq("status", "pending_approval").eq("kind", "main");
  const pending = new Map((pos ?? []).map((p) => [p.id as string, p]));
  const byPo = new Map<string, { number: string; names: string[] }>();
  for (const p of withPo) {
    const po = pending.get(p.po_id as string);
    if (!po) continue;
    await admin.from("purchase_order_lines").update({ is_active: false, updated_by: by.id }).eq("id", p.po_line_id as string);
    const got = byPo.get(po.id as string) ?? { number: po.number as string, names: [] };
    got.names.push(String(p.description).toUpperCase());
    byPo.set(po.id as string, got);
  }
  for (const [poId, got] of byPo) {
    const t = await retotalPo(poId, by.id);
    if (!t.lines) {
      await admin.from("purchase_orders").update({ status: "cancelled", notes: "Every line was deleted before approval", updated_by: by.id }).eq("id", poId);
      await releaseCharges(poId, by.id);
    }
    const { data: job } = await admin.from("jobs").select("job_number").eq("id", jobId).maybeSingle();
    await admin.from("job_events").insert({ job_id: jobId, event_type: "po_part_removed", note: `${got.number}: ${got.names.join(", ")} ${what} by ${by.display_name} while it waits for approval. ${t.lines ? `New total ${aedText(t.total)}.` : "No line left: the LPO is cancelled."}`, created_by: by.id });
    await notifyStaff(await approverIds(), { type: "po_approval", title: `${got.number} updated after sending`, body: `${job?.job_number ?? ""} · ${got.names.join(", ")} ${what} by ${by.display_name}. ${t.lines ? `The approval page shows the current list (new total ${aedText(t.total)}).` : "No line left: the LPO is cancelled."}`, jobId, href: `/parts/orders/${poId}` });
  }
}

/** Put back (or Undo) of a part whose line was cut from a still-pending main LPO: the line comes back, the total follows. */
export async function restorePendingLpoLines(jobId: string, partIds: string[], by: Actor): Promise<void> {
  if (!partIds.length) return;
  const admin = createAdminClient();
  const { data: parts } = await admin.from("part_items").select("id, description, po_id, po_line_id").in("id", partIds).not("po_line_id", "is", null);
  const poIds = Array.from(new Set((parts ?? []).map((p) => p.po_id as string).filter(Boolean)));
  if (!poIds.length) return;
  const { data: pos } = await admin.from("purchase_orders").select("id, number").in("id", poIds).eq("status", "pending_approval").eq("kind", "main");
  const pending = new Map((pos ?? []).map((p) => [p.id as string, p.number as string]));
  const byPo = new Map<string, string[]>();
  for (const p of parts ?? []) {
    if (!pending.has(p.po_id as string)) continue;
    await admin.from("purchase_order_lines").update({ is_active: true, updated_by: by.id }).eq("id", p.po_line_id as string);
    byPo.set(p.po_id as string, [...(byPo.get(p.po_id as string) ?? []), String(p.description).toUpperCase()]);
  }
  for (const [poId, names] of byPo) {
    const t = await retotalPo(poId, by.id);
    await notifyStaff(await approverIds(), { type: "po_approval", title: `${pending.get(poId)} updated: ${names.join(", ")} put back`, body: `New total ${aedText(t.total)}. The approval page shows the current list.`, jobId, href: `/parts/orders/${poId}` });
  }
}

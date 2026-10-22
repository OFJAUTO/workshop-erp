import { newLabelCode } from "@/lib/parts-data";
import "server-only";
import { randomBytes } from "node:crypto";
import { dubaiDate } from "./jobs";
import { round2 } from "./money";
import { notifyManagers, notifyRoles, notifyStaff } from "./notifications";
import { PART_FULL_SELECT, PO_LINE_SELECT, PO_SELECT, toPartFull, toPo, toPoLine, type PartFull, type PoLineRow, type PurchaseOrderRow } from "./parts-data";
import { createAdminClient } from "./supabase/admin";
import { attachChargesToPo, chargesByPo, moveChargesToSupplierPo, type SupplierCharge } from "./supplier-charges";

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
};

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
  return {
    main,
    mainLines: main ? lines.filter((l) => l.po_id === main.id) : [],
    mainCharges: main ? charges.get(main.id) ?? [] : [],
    suppliers,
    toOrder: parts.filter((p) => p.order_status === "to_order" && !p.po_id),
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

const lineOf = (p: PartFull, i: number) => ({ part_item_id: p.id, position: i + 1, description: p.description, part_number: p.part_number, quantity: Number(p.confirmed_quantity ?? p.quantity) || 1, unit_cost: p.cost_aed ?? 0, list_price: p.list_price_aed ?? null, discount_percent: p.discount_percent ?? null });

/**
 * "Send LPO for approval": the one main LPO for the job with every approved part still to order, whatever the
 * supplier. It waits for the owner or the head accountant. Parts from our own stock never go on it.
 */
export async function createMainLpo(jobId: string, by: Actor): Promise<{ error?: string; poId?: string; number?: string }> {
  const admin = createAdminClient();
  const { data: job } = await admin.from("jobs").select("id, job_number, is_open, status").eq("id", jobId).maybeSingle();
  if (!job || !job.is_open) return { error: "This job is closed." };
  const { toOrder, main } = await loadJobLpos(jobId);
  if (main && main.status === "pending_approval") return { error: `${main.number} is already waiting for approval.` };
  if (!toOrder.length) return { error: "Nothing to order: every approved part is from stock or already on an LPO." };
  const unpriced = toOrder.filter((p) => p.cost_aed === null || !p.supplier || p.supplier.trim() === "");
  if (unpriced.length) return { error: `${unpriced.length} part${unpriced.length === 1 ? " has" : "s have"} no price or supplier yet (${unpriced.map((p) => p.description).join(", ")}). Finish them in the table first.` };
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
    const key = (p.supplier ?? "").trim() || "Supplier";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const { data: existing } = await admin.from("purchase_orders").select("sub_number").eq("parent_id", mainId);
  let next = Math.max(0, ...(existing ?? []).map((e) => Number(e.sub_number) || 0));
  const created: { id: string; number: string; supplier: string }[] = [];
  for (const [supplierName, items] of groups) {
    next++;
    const { data: sup } = await admin.from("suppliers").select("id").ilike("name", supplierName).maybeSingle();
    let supplierId = sup?.id ?? null;
    if (!supplierId) {
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
    if (!job.plan_released_at) await notifyManagers(job.department ?? null, { type: "planning", title: `Plan the work · ${job.job_number}`, body: `${text}. Pick the start day and the technicians, then Release to workshop.`, jobId, href: `/jobs/${jobId}#planning` });
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

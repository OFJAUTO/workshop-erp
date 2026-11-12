import "server-only";
import { createAdminClient } from "./supabase/admin";
import { notifyRoles, notifyStaff } from "./notifications";
import { formatPlate } from "./types";

/*
 * 13 November 2026, Section 7: an estimate accepted (or paid) tells the parts desk to ORDER PARTS, at the right moment.
 *  - No deposit requested (no proforma on the estimate): at the customer's acceptance.
 *  - A deposit requested (a proforma issued): only once the money is recorded; until then the parts desk sees
 *    "Approved: waiting for deposit".
 *  - Paid by a cheque not cleared yet: the alert says so, and ordering needs the owner (the LPO approval's no-advance
 *    gate refuses anyone else).
 * The parts desk and the advisors in charge are told ONCE per state (a quotation event marks it).
 */

export type OrderState = "ready" | "waiting_deposit" | "cheque_pending" | "ordered" | "none";
export type OrderRow = { estimateId: string; number: string; car: string; parts: number; state: OrderState; words: string };

const STATE_WORDS: Record<OrderState, string> = {
  ready: "advance received",
  waiting_deposit: "Approved: waiting for deposit",
  cheque_pending: "advance by cheque not cleared yet: the owner approves the order",
  ordered: "parts ordered",
  none: "",
};

type Est = { id: string; number: string; status: string; vehicle_id: string | null; customer_id: string; job_id: string | null; carried_job_id: string | null; cancelled_at: string | null; created_by: string | null; is_active: boolean };

async function familyInvoices(number: string): Promise<{ ids: string[]; proformas: { id: string; total_aed: number }[] }> {
  const admin = createAdminClient();
  const { data: fam } = await admin.from("quotations").select("id").eq("number", number).eq("kind", "estimate");
  const ids = ((fam ?? []) as { id: string }[]).map((f) => f.id);
  if (!ids.length) return { ids, proformas: [] };
  const { data: inv } = await admin.from("invoices").select("id, kind, total_aed, status").in("estimate_id", ids).eq("is_active", true).neq("status", "void");
  return { ids, proformas: ((inv ?? []) as { id: string; kind: string; total_aed: number }[]).filter((i) => i.kind === "proforma" || i.kind === "tax_invoice").map((i) => ({ id: i.id, total_aed: Number(i.total_aed) })) };
}

/** Where an accepted estimate stands for ordering its parts. */
export async function estimateOrderState(estimateId: string): Promise<{ state: OrderState; parts: number; est: Est | null }> {
  const admin = createAdminClient();
  const { data } = await admin.from("quotations").select("id, number, status, vehicle_id, customer_id, job_id, carried_job_id, cancelled_at, created_by, is_active").eq("id", estimateId).maybeSingle();
  const est = data as Est | null;
  if (!est || !est.is_active || est.status !== "approved" || est.cancelled_at || est.carried_job_id || est.job_id) return { state: "none", parts: 0, est };
  const { data: lines } = await admin.from("quotation_lines").select("id, unit_cost, priced_at").eq("quotation_id", est.id).eq("is_active", true).eq("line_type", "part");
  const parts = ((lines ?? []) as { unit_cost: number | null; priced_at: string | null }[]).filter((l) => l.priced_at && l.unit_cost !== null).length;
  if (!parts) return { state: "none", parts: 0, est };
  // Already ordered: a held job with an LPO.
  const { data: held } = await admin.from("jobs").select("id").eq("estimate_id", est.id).eq("status", "booked").limit(1);
  if (held?.length) {
    const { data: lpo } = await admin.from("purchase_orders").select("id").eq("job_id", held[0].id).neq("status", "cancelled").limit(1);
    if (lpo?.length) return { state: "ordered", parts, est };
  }
  const fam = await familyInvoices(est.number);
  if (!fam.proformas.length) return { state: "ready", parts, est };
  const { data: pays } = await admin.from("payments").select("amount_aed, status, method, cheque_status").in("invoice_id", fam.proformas.map((p) => p.id)).eq("status", "recorded").eq("is_active", true);
  const rows = (pays ?? []) as { amount_aed: number; method: string; cheque_status: string | null }[];
  const cleared = rows.filter((p) => p.method !== "cheque" || p.cheque_status === "cleared");
  if (cleared.length) return { state: "ready", parts, est };
  if (rows.some((p) => p.method === "cheque")) return { state: "cheque_pending", parts, est };
  return { state: "waiting_deposit", parts, est };
}

/** Tells the parts desk and the advisors "ORDER PARTS: …" once per state that allows ordering. */
export async function alertOrderParts(estimateId: string): Promise<OrderState> {
  const { state, parts, est } = await estimateOrderState(estimateId);
  if (!est || (state !== "ready" && state !== "cheque_pending")) return state;
  const admin = createAdminClient();
  const marker = `order_parts_alert:${state}`;
  const { data: seen } = await admin.from("quotation_events").select("id").eq("quotation_id", est.id).eq("event_type", marker).limit(1);
  if (seen?.length) return state;
  const { data: v } = est.vehicle_id ? await admin.from("vehicles").select("kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant, make:vehicle_makes(name), model:vehicle_models(name)").eq("id", est.vehicle_id).maybeSingle() : { data: null };
  const car = v ? [(v as { make?: { name?: string } }).make?.name, (v as { model?: { name?: string } }).model?.name, formatPlate(v as Parameters<typeof formatPlate>[0])].filter(Boolean).join(" · ") : "car not on record";
  // "advance received" only when money came in; an estimate with no deposit asked says so.
  const fam = await familyInvoices(est.number);
  const why = state === "ready" && !fam.proformas.length ? "no deposit asked" : STATE_WORDS[state];
  const title = `ORDER PARTS: ${est.number} · ${car} · ${parts} part${parts === 1 ? "" : "s"} · ${why}`;
  const notice = { type: "order_parts_estimate", title, body: state === "cheque_pending" ? "The cheque has not cleared: ordering needs the owner's approval on the LPO." : "Open the estimate's parts and press Order parts now: the LPO is made for approval.", href: `/parts/estimate/${est.id}#order-parts` };
  await notifyRoles(["parts"], notice);
  const { quoteLeadIds } = await import("./quote-lead");
  await notifyStaff(await quoteLeadIds({ id: est.id, number: est.number, kind: "estimate", job_id: null, created_by: est.created_by } as Parameters<typeof quoteLeadIds>[0]), { ...notice, href: `/estimates/${est.id}` }).catch(() => null);
  await admin.from("quotation_events").insert({ quotation_id: est.id, event_type: marker, note: title });
  return state;
}

/** The parts desk's "Ready to order" list: accepted estimates with priced parts, not ordered yet. */
export async function estimatesToOrder(): Promise<OrderRow[]> {
  const admin = createAdminClient();
  const { data } = await admin.from("quotations").select("id").eq("kind", "estimate").eq("status", "approved").eq("is_active", true).is("cancelled_at", null).is("job_id", null).is("carried_job_id", null).order("updated_at", { ascending: false }).limit(60);
  const out: OrderRow[] = [];
  for (const r of (data ?? []) as { id: string }[]) {
    const s = await estimateOrderState(r.id);
    if (!s.est || s.state === "none" || s.state === "ordered") continue;
    out.push({ estimateId: r.id, number: s.est.number, car: "", parts: s.parts, state: s.state, words: STATE_WORDS[s.state] });
  }
  return out;
}

export { STATE_WORDS as ORDER_STATE_WORDS };

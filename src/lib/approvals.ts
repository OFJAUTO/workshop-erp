import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { schemaReady } from "@/lib/schema-ready";

/**
 * THE OWNER'S APPROVALS (11 November 2026, Section 4): everything in the ERP waiting for the owner's yes or no, from
 * one loader. The Approvals page lists them all; each item's own page shows its yellow "NEEDS YOUR APPROVAL" box at the
 * top (src/components/ApprovalBox.tsx, the ONE box); the menu count and the dashboard tile read the same list.
 * Approve and Refuse go through ONE dispatcher (src/app/(app)/approvals/actions.ts) to each kind's own decision, so
 * the rules of each decision stay where they are.
 */
export const APPROVAL_KINDS = ["quote", "revision", "commission", "lpo", "discount", "fee", "price", "free_charge", "inspection_change", "stock_reversal", "comeback", "overpayment", "void", "lathe_void", "inspection_type", "part_change"] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];

export const KIND_WORDS: Record<ApprovalKind, string> = {
  quote: "Quotation",
  revision: "Revision of an approved quotation",
  commission: "Commission",
  lpo: "LPO",
  discount: "Supplier discount",
  fee: "Inspection fee below the minimum",
  price: "Supplier price went up",
  free_charge: "Free charge",
  inspection_change: "Change to an approved report",
  stock_reversal: "Stock reversal",
  comeback: "Comeback at our cost",
  overpayment: "Payment above the balance",
  void: "Void a receipt",
  lathe_void: "Void a lathe bill",
  inspection_type: "Inspection type downgrade",
  part_change: "Part supplier or price change",
};

export type ApprovalItem = {
  /** "<kind>:<id>" - also the page anchor and the ?approval= highlight. */
  key: string;
  kind: ApprovalKind;
  /** The record the decision acts on (for a free charge "<jobId>:<lineId>"). */
  id: string;
  title: string;
  what: string;
  askedBy: string | null;
  askedAt: string | null;
  money: string | null;
  href: string;
  jobId: string | null;
  quotationId: string | null;
  poId: string | null;
  /** The words of the two buttons. */
  approveLabel: string;
  refuseLabel: string;
};

const aed = (n: unknown) => `AED ${(Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Scope = { jobId?: string; quotationId?: string; poId?: string };

/** Every item waiting for the owner (optionally only those of one job, quotation or LPO), oldest first. */
export async function loadApprovals(scope: Scope = {}): Promise<ApprovalItem[]> {
  const admin = createAdminClient();
  const out: ApprovalItem[] = [];
  // The waiting sets are small: read them whole, then keep the page's own (one job, quotation or LPO).
  const [quotes, revisions, commissions, pos, discounts, fees, prices, frees, changes, reversals, comebacks, overs] = await Promise.all([
    admin.from("quotations").select("id, number, version, kind, job_id, total_aed, owner_approval_reason, comp_reason, completed_by, updated_at").eq("status", "pending_owner").eq("is_active", true),
    admin.from("quotations").select("id, number, version, job_id, revision_request_reason, revision_requested_by, revision_requested_at").not("revision_requested_at", "is", null).is("revision_allowed_at", null).is("revision_declined_at", null).eq("is_active", true),
    admin.from("quotations").select("id, number, job_id, commission_to, commission_aed, commission_set_by, commission_set_at").eq("commission_status", "pending").eq("is_active", true),
    admin.from("purchase_orders").select("id, number, job_id, supplier_name, total_cost_aed, created_by, created_at").eq("status", "pending_approval").eq("is_active", true),
    admin.from("part_items").select("id, job_id, description, discount_percent, cost_aed, supplier, updated_by, updated_at").eq("discount_approval_status", "pending").eq("is_active", true),
    admin.from("jobs").select("id, job_number, inspection_fee_aed, inspection_fee_request_aed, inspection_fee_request_by, updated_at").not("inspection_fee_request_aed", "is", null),
    admin.from("purchase_order_lines").select("id, po_id, description, unit_cost, invoice_unit_cost, quantity, invoice_check_by, invoice_check_at").eq("invoice_check", "mismatch").eq("is_active", true),
    (await schemaReady("charge_lines", "free_status")) ? admin.from("charge_lines").select("id, job_id, kind, description, charge_aed, cost_aed, created_by, created_at").eq("free_status", "pending_owner").eq("is_active", true).not("job_id", "is", null) : Promise.resolve({ data: [] }),
    admin.from("inspection_change_requests").select("id, inspection_id, reason, requested_by, created_at").eq("status", "pending"),
    (await schemaReady("stock_reversals", "status")) ? admin.from("stock_reversals").select("id, job_id, kind, quantity, reason, stock_item_id, created_by, created_at").eq("status", "pending").eq("is_active", true) : Promise.resolve({ data: [] }),
    admin.from("jobs").select("id, job_number, comeback_cause, comeback_of, updated_by, updated_at").not("comeback_cause", "is", null).is("comeback_confirmed_at", null).eq("is_open", true),
    admin.from("payments").select("id, receipt_number, job_id, amount_aed, method, created_by, created_at").eq("status", "pending_owner"),
  ]);
  type R = Record<string, unknown>;
  const rows = (r: unknown) => (((r as { data?: unknown } | null)?.data ?? []) as R[]);
  // Inspection change requests carry the inspection: its job.
  const changeRows = rows(changes);
  const { data: insp } = changeRows.length ? await admin.from("inspections").select("id, job_id").in("id", changeRows.map((c) => String(c.inspection_id))) : { data: [] };
  const jobOfInsp = new Map(((insp ?? []) as R[]).map((i) => [String(i.id), String(i.job_id)]));
  const poRowsForPrices = rows(prices);
  const { data: pricePos } = poRowsForPrices.length ? await admin.from("purchase_orders").select("id, number, job_id, supplier_name").in("id", Array.from(new Set(poRowsForPrices.map((p) => String(p.po_id))))) : { data: [] };
  const poById = new Map(((pricePos ?? []) as R[]).map((p) => [String(p.id), p]));
  // Job numbers and plates, and the staff names, in one read each.
  const jobIds = new Set<string>();
  const staffIds = new Set<string>();
  const addJ = (v: unknown) => { if (v) jobIds.add(String(v)); };
  const addS = (v: unknown) => { if (v) staffIds.add(String(v)); };
  for (const r of rows(quotes)) { addJ(r.job_id); addS(r.completed_by); }
  for (const r of rows(revisions)) { addJ(r.job_id); addS(r.revision_requested_by); }
  for (const r of rows(commissions)) { addJ(r.job_id); addS(r.commission_set_by); }
  for (const r of rows(pos)) { addJ(r.job_id); addS(r.created_by); }
  for (const r of rows(discounts)) { addJ(r.job_id); addS(r.updated_by); }
  for (const r of rows(fees)) { addJ(r.id); addS(r.inspection_fee_request_by); }
  for (const r of poRowsForPrices) { addJ(poById.get(String(r.po_id))?.job_id); addS(r.invoice_check_by); }
  for (const r of rows(frees)) { addJ(r.job_id); addS(r.created_by); }
  for (const r of changeRows) { addJ(jobOfInsp.get(String(r.inspection_id))); addS(r.requested_by); }
  for (const r of rows(reversals)) { addJ(r.job_id); addS(r.created_by); }
  for (const r of rows(comebacks)) { addJ(r.id); addS(r.updated_by); }
  for (const r of rows(overs)) { addJ(r.job_id); addS(r.created_by); }
  const [{ data: jobRows }, { data: staffRows }] = await Promise.all([
    jobIds.size ? admin.from("jobs").select("id, job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, variant)").in("id", Array.from(jobIds)) : Promise.resolve({ data: [] }),
    staffIds.size ? admin.from("staff").select("id, display_name").in("id", Array.from(staffIds)) : Promise.resolve({ data: [] }),
  ]);
  const jobWords = new Map(((jobRows ?? []) as R[]).map((j) => [String(j.id), [String(j.job_number), j.vehicle ? formatPlate(j.vehicle as Parameters<typeof formatPlate>[0]) : ""].filter(Boolean).join(" · ")]));
  const who = new Map(((staffRows ?? []) as R[]).map((s) => [String(s.id), String(s.display_name)]));
  const jw = (id: unknown) => (id ? jobWords.get(String(id)) ?? "" : "");
  const nm = (id: unknown) => (id ? who.get(String(id)) ?? null : null);
  const push = (i: Omit<ApprovalItem, "key" | "approveLabel" | "refuseLabel"> & Partial<Pick<ApprovalItem, "approveLabel" | "refuseLabel">>) => out.push({ approveLabel: "Approve", refuseLabel: "Refuse", ...i, key: `${i.kind}:${i.id}` });

  {
    for (const r of rows(quotes)) {
      const isEst = r.kind === "estimate" || !r.job_id;
      push({ kind: "quote", id: String(r.id), title: `${r.comp_reason ? "Complimentary" : isEst ? "Estimate" : "Quotation"} needs your approval · ${r.number} v${r.version}`, what: String(r.owner_approval_reason ?? "Above an advisor's limit"), askedBy: nm(r.completed_by), askedAt: (r.updated_at as string) ?? null, money: aed(r.total_aed), href: r.job_id ? `/jobs/${r.job_id}/quote/${r.id}` : `/estimates/${r.id}`, jobId: (r.job_id as string) ?? null, quotationId: String(r.id), poId: null, refuseLabel: "Ask for changes" });
    }
    for (const r of rows(revisions)) {
      push({ kind: "revision", id: String(r.id), title: `Revision of approved ${r.number} v${r.version}`, what: String(r.revision_request_reason ?? "A change after the customer approved"), askedBy: nm(r.revision_requested_by), askedAt: (r.revision_requested_at as string) ?? null, money: null, href: r.job_id ? `/jobs/${r.job_id}/quote/${r.id}` : `/estimates/${r.id}`, jobId: (r.job_id as string) ?? null, quotationId: String(r.id), poId: null, approveLabel: "Allow one revision", refuseLabel: "Decline" });
    }
    for (const r of rows(commissions)) {
      push({ kind: "commission", id: String(r.id), title: `Commission on ${r.number}${r.commission_to ? ` to ${r.commission_to}` : ""}`, what: jw(r.job_id), askedBy: nm(r.commission_set_by), askedAt: (r.commission_set_at as string) ?? null, money: aed(r.commission_aed), href: r.job_id ? `/jobs/${r.job_id}/quote/${r.id}` : `/estimates/${r.id}`, jobId: (r.job_id as string) ?? null, quotationId: String(r.id), poId: null, refuseLabel: "Decline" });
    }
  }
  for (const r of rows(pos)) {
    push({ kind: "lpo", id: String(r.id), title: `LPO ${r.number} to approve`, what: [r.supplier_name, jw(r.job_id) || "stock order"].filter(Boolean).join(" · "), askedBy: nm(r.created_by), askedAt: (r.created_at as string) ?? null, money: `${aed(r.total_cost_aed)} before VAT`, href: `/parts/orders/${r.id}`, jobId: (r.job_id as string) ?? null, quotationId: null, poId: String(r.id) });
  }
  for (const r of rows(discounts)) {
    push({ kind: "discount", id: String(r.id), title: `Supplier discount ${Number(r.discount_percent)}% · ${String(r.description).toUpperCase()}`, what: [jw(r.job_id), r.supplier].filter(Boolean).join(" · "), askedBy: nm(r.updated_by), askedAt: (r.updated_at as string) ?? null, money: `net ${aed(r.cost_aed)}`, href: `/parts/${r.job_id}`, jobId: (r.job_id as string) ?? null, quotationId: null, poId: null });
  }
  for (const r of rows(fees)) {
    push({ kind: "fee", id: String(r.id), title: `Inspection fee ${aed(r.inspection_fee_request_aed)} · ${r.job_number}`, what: `Asked below the minimum (now ${aed(r.inspection_fee_aed)})`, askedBy: nm(r.inspection_fee_request_by), askedAt: (r.updated_at as string) ?? null, money: aed(r.inspection_fee_request_aed), href: `/jobs/${r.id}`, jobId: String(r.id), quotationId: null, poId: null });
  }
  for (const r of poRowsForPrices) {
    const po = poById.get(String(r.po_id));
    const up = (Number(r.invoice_unit_cost) - Number(r.unit_cost)) * (Number(r.quantity) || 1);
    push({ kind: "price", id: String(r.id), title: `Supplier price up · ${String(r.description).toUpperCase()}`, what: [po?.number, po?.supplier_name, jw(po?.job_id)].filter(Boolean).join(" · "), askedBy: nm(r.invoice_check_by), askedAt: (r.invoice_check_at as string) ?? null, money: `${aed(r.unit_cost)} → ${aed(r.invoice_unit_cost)} each (+${aed(up).replace("AED ", "")})`, href: `/parts/orders/${r.po_id}`, jobId: (po?.job_id as string) ?? null, quotationId: null, poId: String(r.po_id), approveLabel: "OK, accept", refuseLabel: "Query with supplier" });
  }
  for (const r of rows(frees)) {
    push({ kind: "free_charge", id: `${r.job_id}:${r.id}`, title: `Free ${String(r.kind)} charge · ${jw(r.job_id)}`, what: String(r.description ?? ""), askedBy: nm(r.created_by), askedAt: (r.created_at as string) ?? null, money: `cost ${aed(r.cost_aed)}`, href: `/jobs/${r.job_id}#charges`, jobId: (r.job_id as string) ?? null, quotationId: null, poId: null });
  }
  for (const r of changeRows) {
    const jobId = jobOfInsp.get(String(r.inspection_id)) ?? null;
    push({ kind: "inspection_change", id: `${jobId}:${r.id}`, title: `Change to an approved report · ${jw(jobId)}`, what: String(r.reason ?? ""), askedBy: nm(r.requested_by), askedAt: (r.created_at as string) ?? null, money: null, href: `/jobs/${jobId}/inspection`, jobId, quotationId: null, poId: null });
  }
  for (const r of rows(reversals)) {
    push({ kind: "stock_reversal", id: String(r.id), title: `Stock ${r.kind === "move" ? "move to a job" : "reversal"} · ${Number(r.quantity)} item${Number(r.quantity) === 1 ? "" : "s"}`, what: String(r.reason ?? ""), askedBy: nm(r.created_by), askedAt: (r.created_at as string) ?? null, money: null, href: "/parts/stock", jobId: (r.job_id as string) ?? null, quotationId: null, poId: null });
  }
  for (const r of rows(comebacks)) {
    push({ kind: "comeback", id: String(r.id), title: `Comeback · ${jw(r.id)}`, what: `Cause: ${String(r.comeback_cause).replace(/_/g, " ")}. Approve = at our cost (warranty repair); Refuse = the customer pays.`, askedBy: nm(r.updated_by), askedAt: (r.updated_at as string) ?? null, money: null, href: `/jobs/${r.id}#comeback`, jobId: String(r.id), quotationId: null, poId: null, approveLabel: "At our cost", refuseLabel: "Customer pays" });
  }
  for (const r of rows(overs)) {
    push({ kind: "overpayment", id: String(r.id), title: `Payment above the balance · ${r.receipt_number ?? ""}`, what: jw(r.job_id), askedBy: nm(r.created_by), askedAt: (r.created_at as string) ?? null, money: aed(r.amount_aed), href: r.job_id ? `/jobs/${r.job_id}/invoice` : "/invoices", jobId: (r.job_id as string) ?? null, quotationId: null, poId: null });
  }
  // Receipt voids asked by accounts (11 November 2026, Section 5).
  if (await schemaReady("payments", "void_requested_at")) {
    const { data: voids } = await admin.from("payments").select("id, number, job_id, amount_aed, method, cheque_number, void_request_reason, void_requested_by, void_requested_at").not("void_requested_at", "is", null).in("status", ["recorded", "pending_owner"]);
    const vr = (voids ?? []) as R[];
    const extraStaff = vr.map((v) => String(v.void_requested_by)).filter((x) => x && !who.has(x));
    const extraJobs = vr.map((v) => String(v.job_id ?? "")).filter((x) => x && !jobWords.has(x));
    if (extraStaff.length) for (const st of ((await admin.from("staff").select("id, display_name").in("id", extraStaff)).data ?? []) as R[]) who.set(String(st.id), String(st.display_name));
    if (extraJobs.length) for (const j of ((await admin.from("jobs").select("id, job_number").in("id", extraJobs)).data ?? []) as R[]) jobWords.set(String(j.id), String(j.job_number));
    for (const r of vr) {
      push({ kind: "void", id: String(r.id), title: `Void receipt ${r.number}${r.cheque_number ? ` · cheque ${r.cheque_number}` : ""}`, what: `${String(r.void_request_reason ?? "")}${r.job_id ? ` · ${jw(r.job_id)}` : ""}`, askedBy: nm(r.void_requested_by), askedAt: (r.void_requested_at as string) ?? null, money: aed(r.amount_aed), href: r.job_id ? `/jobs/${r.job_id}/invoice` : "/accounts-posting?tab=cheque", jobId: (r.job_id as string) ?? null, quotationId: null, poId: null, approveLabel: "Void it", refuseLabel: "Keep the receipt" });
    }
  }
  // Lathe bills paid or in Zoho that accounts asked to void (11 November 2026, Section 6).
  if (await schemaReady("lathe_bills", "void_requested_at")) {
    const { data: lv } = await admin.from("lathe_bills").select("id, bill_number, supplier_name, total_aed, void_request_reason, void_requested_by, void_requested_at").not("void_requested_at", "is", null).is("voided_at", null);
    for (const r of (lv ?? []) as R[]) {
      if (r.void_requested_by && !who.has(String(r.void_requested_by))) for (const st of ((await admin.from("staff").select("id, display_name").eq("id", String(r.void_requested_by))).data ?? []) as R[]) who.set(String(st.id), String(st.display_name));
      push({ kind: "lathe_void", id: String(r.id), title: `Void lathe bill ${r.bill_number} · ${r.supplier_name}`, what: String(r.void_request_reason ?? ""), askedBy: nm(r.void_requested_by), askedAt: (r.void_requested_at as string) ?? null, money: aed(r.total_aed), href: "/parts/lathe", jobId: null, quotationId: null, poId: null, approveLabel: "Void it", refuseLabel: "Keep the bill" });
    }
  }
  // An inspection type made smaller after the start (11 November 2026, Section 10).
  if (await schemaReady("jobs", "inspection_scope_request")) {
    const { data: ir } = await admin.from("jobs").select("id, job_number, inspection_scope, inspection_scope_request, inspection_scope_request_reason, inspection_scope_request_by, inspection_scope_request_at").not("inspection_scope_request", "is", null);
    const { scopeLabel } = await import("@/lib/inspection-scope");
    for (const r of (ir ?? []) as R[]) {
      if (r.inspection_scope_request_by && !who.has(String(r.inspection_scope_request_by))) for (const st of ((await admin.from("staff").select("id, display_name").eq("id", String(r.inspection_scope_request_by))).data ?? []) as R[]) who.set(String(st.id), String(st.display_name));
      push({ kind: "inspection_type", id: String(r.id), title: `Inspection type: ${scopeLabel(r.inspection_scope as string)} → ${scopeLabel(r.inspection_scope_request as string)} · ${r.job_number}`, what: String(r.inspection_scope_request_reason ?? ""), askedBy: nm(r.inspection_scope_request_by), askedAt: (r.inspection_scope_request_at as string) ?? null, money: null, href: `/jobs/${r.id}`, jobId: String(r.id), quotationId: null, poId: null, approveLabel: "Allow the change", refuseLabel: "Keep it" });
    }
  }
  // A part's supplier or price changed in place, cost up or another type (13 November 2026, Section 3).
  if (await schemaReady("part_changes", "status, words")) {
    const { data: pc } = await admin.from("part_changes").select("id, job_id, words, price_choice, absorb_aed, created_by, created_at").eq("status", "pending").eq("is_active", true);
    for (const r of (pc ?? []) as R[]) {
      if (r.created_by && !who.has(String(r.created_by))) for (const st of ((await admin.from("staff").select("id, display_name").eq("id", String(r.created_by))).data ?? []) as R[]) who.set(String(st.id), String(st.display_name));
      if (r.job_id && !jobWords.has(String(r.job_id))) for (const j of ((await admin.from("jobs").select("id, job_number").eq("id", String(r.job_id))).data ?? []) as R[]) jobWords.set(String(j.id), String(j.job_number));
      const keep = r.price_choice === "keep";
      push({ kind: "part_change", id: String(r.id), title: `Part change · ${jw(r.job_id)}`, what: `${String(r.words)}${keep ? " · keep the customer's price" : r.price_choice === "revise" ? " · then revise the quotation" : ""}`, askedBy: nm(r.created_by), askedAt: (r.created_at as string) ?? null, money: keep && Number(r.absorb_aed) > 0 ? `we absorb ${aed(r.absorb_aed)}` : null, href: `/parts/${r.job_id}`, jobId: String(r.job_id), quotationId: null, poId: null });
    }
  }
  for (const extra of await moreApprovals(scope)) out.push(extra);
  const kept = out.filter((i) => (!scope.jobId || i.jobId === scope.jobId) && (!scope.quotationId || i.quotationId === scope.quotationId) && (!scope.poId || i.poId === scope.poId));
  return kept.sort((a, b) => String(a.askedAt ?? "").localeCompare(String(b.askedAt ?? "")));
}

/** Later kinds (receipt voids, inspection downgrades) register here, so the one list and the one box serve them too. */
const moreLoaders: ((scope: Scope) => Promise<ApprovalItem[]>)[] = [];
export function registerApprovalLoader(fn: (scope: Scope) => Promise<ApprovalItem[]>) {
  moreLoaders.push(fn);
}
async function moreApprovals(scope: Scope): Promise<ApprovalItem[]> {
  const all = await Promise.all(moreLoaders.map((f) => f(scope).catch(() => [] as ApprovalItem[])));
  return all.flat();
}

/** The count for the menu and the dashboard tile. */
export async function approvalsCount(): Promise<number> {
  return (await loadApprovals()).length;
}

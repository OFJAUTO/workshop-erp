import "server-only";
import { createAdminClient } from "./supabase/admin";
import { logAppError, SAVE_FAILED } from "./app-errors";
import { schemaReady } from "./schema-ready";
import { round2 } from "./money";
import { supplierChargesVat } from "./supplier-rules";
import { returnCreditOf } from "./part-endings";
import { paidOnPos } from "./supplier-payments";
import { flagZohoAttention } from "./zoho-sync";
import { withdrawCancelled } from "./zoho-cancelled";
import { notifyRoles } from "./notifications";
import {
  invoiceStillExpected,
  legacyEndingOf,
  NO_CREDIT_ENDINGS,
  RETURN_ENDING_LABEL,
  RETURN_LINE_WORDS,
  returnEndingRefusal,
  returnEndingsFor,
  type EndingHistoryEntry,
  type ReturnEndingChoices,
  type ReturnEndingKey,
  type ReturnFacts,
} from "./return-ending-rules";

/*
 * HOW A PURCHASE RETURN ENDS (20 November 2026, Section 1). The server half of src/lib/return-ending-rules.ts: the
 * facts of one returned part (invoice? paid? value? with the technician?), its ending saved with who and when, the
 * advance the parts desk asks and accounts confirm, the correction ("Correct how this return was settled": the old
 * ending and any credit note it carried are kept in the history, voided), the LPO's invoice state ("not_expected" once
 * every part went back before invoicing), and the Zoho supplier credit withdrawn when no credit will ever come.
 */

type Actor = { id: string; display_name: string; role_id: string };
const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The database update of 20 November (migration 20261220090000_return_endings) is in. */
export const returnEndingsReady = () => schemaReady("part_items", "return_ending,return_ending_history,return_advance_status");

export type ReturnEndingView = {
  partId: string;
  jobId: string | null;
  poId: string | null;
  poNumber: string | null;
  name: string;
  facts: ReturnFacts;
  ending: ReturnEndingKey | null;
  endingWords: string | null;
  endedBy: string | null;
  endedAt: string | null;
  advance: { amount: number; status: string } | null;
  choices: ReturnEndingChoices;
  history: EndingHistoryEntry[];
  /** The stored ending does not fit the facts (e.g. a credit note with no invoice): accounts correct it. */
  wrong: string | null;
  creditNote: string | null;
};

type PartRow = Record<string, unknown>;

async function partRow(partId: string): Promise<PartRow | null> {
  const { data, error } = await createAdminClient().from("part_items").select("*").eq("id", partId).maybeSingle();
  if (error) {
    await logAppError("return-endings: part", error, { detail: { partId } });
    return null;
  }
  return (data as PartRow | null) ?? null;
}

/** The facts of a returned part. */
export async function returnFactsOf(p: PartRow): Promise<{ facts: ReturnFacts; po: Record<string, unknown> | null }> {
  const admin = createAdminClient();
  const poId = (p.po_id as string | null) ?? null;
  const { data: po } = poId ? await admin.from("purchase_orders").select("id, number, job_id, status, supplier_id, supplier_name, supplier_invoice_status, supplier_invoice_number, supplier_paid_at, total_cost_aed").eq("id", poId).maybeSingle() : { data: null };
  let invoiced = !!po && po.supplier_invoice_status === "received" && !!po.supplier_invoice_number;
  if (!invoiced && poId && (await schemaReady("lpo_invoices", "id"))) {
    const { data: more } = await admin.from("lpo_invoices").select("id, status").eq("po_id", poId);
    invoiced = ((more ?? []) as { status?: string }[]).some((i) => i.status !== "void");
  }
  let paid = 0;
  if (poId) {
    const m = await paidOnPos([poId]);
    for (const [k, v] of m) if (k === poId || k.startsWith(`${poId}~`)) paid = round2(paid + v);
    if (!paid && po?.supplier_paid_at) paid = Number(po.total_cost_aed) || 0;
  }
  const { data: sup } = po?.supplier_id ? await admin.from("suppliers").select("name, trn, vat_registered").eq("id", po.supplier_id).maybeSingle() : { data: null };
  const chargesVat = po ? supplierChargesVat({ name: String(po.supplier_name), trn: (sup as { trn?: string | null } | null)?.trn ?? null, vat_registered: (sup as { vat_registered?: boolean | null } | null)?.vat_registered !== false }) : false;
  const qty = Number(p.returned_qty) || Number(p.received_qty) || Number(p.confirmed_quantity ?? p.quantity) || 1;
  const { data: line } = p.po_line_id ? await admin.from("purchase_order_lines").select("unit_cost, invoice_unit_cost").eq("id", p.po_line_id as string).maybeSingle() : { data: null };
  const net = returnCreditOf({ qty, creditNoteAmount: Number(p.credit_note_amount_aed) || null, invoiceUnit: Number(line?.invoice_unit_cost) || null, lineUnit: Number(line?.unit_cost) || null, finalCost: Number(p.final_cost_aed) || null, cost: Number(p.cost_aed) || null }).amount;
  const value = round2(chargesVat ? net * 1.05 : net);
  const facts: ReturnFacts = {
    invoiced,
    paid: round2(Math.min(paid, paid > 0 ? Math.max(paid, value) : 0)),
    value,
    withTech: p.issue_status === "confirmed",
    hasReplacement: !!p.replacement_part_id,
    creditIn: !!(p.credit_note_number || p.credit_note_path),
  };
  return { facts, po: (po as Record<string, unknown> | null) ?? null };
}

const isReturned = (p: PartRow) => p.disposition === "returned" || p.disposition === "return_pending" || p.return_status === "to_return" || p.return_status === "returned";

/** The ending box of one returned part: facts, the choices, what it ended as, the history and what is wrong. */
export async function returnEndingView(partId: string, role: string): Promise<ReturnEndingView | null> {
  const p = await partRow(partId);
  if (!p || !isReturned(p)) return null;
  const { facts, po } = await returnFactsOf(p);
  const ending = legacyEndingOf(p as never);
  const storedEnding = (p.return_ending as ReturnEndingKey | null) ?? null;
  const stated = p.disposition === "returned" ? ending : storedEnding;
  let wrong: string | null = null;
  if (stated === "credit_note" && !facts.invoiced) wrong = `It says "${RETURN_ENDING_LABEL.credit_note}"${p.credit_note_number || p.disposition_note ? ` (${String(p.credit_note_number ?? p.disposition_note)})` : ""}, but there is no supplier invoice for this part, so nothing can be credited. Correct how this return was settled.`;
  const ids = [p.return_ending_by, p.return_advance_by].filter((x): x is string => typeof x === "string");
  const { data: people } = ids.length ? await createAdminClient().from("staff").select("id, display_name").in("id", ids) : { data: [] };
  const nameOf = new Map(((people ?? []) as { id: string; display_name: string }[]).map((s) => [s.id, s.display_name]));
  const adv = p.return_advance_status ? { amount: Number(p.return_advance_aed) || 0, status: String(p.return_advance_status) } : null;
  return {
    partId,
    jobId: (p.job_id as string | null) ?? null,
    poId: (p.po_id as string | null) ?? null,
    poNumber: (po?.number as string | null) ?? null,
    name: String(p.description ?? "").toUpperCase(),
    facts,
    ending: stated,
    endingWords: stated ? RETURN_LINE_WORDS[stated] + (stated === "advance" && adv?.status === "asked" ? " (accounts to confirm)" : "") : null,
    endedBy: p.return_ending_by ? (nameOf.get(String(p.return_ending_by)) ?? null) : null,
    endedAt: (p.return_ending_at as string | null) ?? null,
    advance: adv,
    choices: returnEndingsFor(facts, role),
    history: Array.isArray(p.return_ending_history) ? (p.return_ending_history as EndingHistoryEntry[]) : [],
    wrong,
    creditNote: (p.credit_note_number as string | null) ?? (p.disposition === "returned" && stated === "credit_note" ? ((p.disposition_note as string | null) ?? null) : null),
  };
}

/** Recompute an LPO's invoice state: every part back before invoicing = "not_expected"; a part that needs one again = "to_follow". */
export async function refreshInvoiceExpected(poId: string, by: Actor): Promise<string | null> {
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("id, number, kind, status, supplier_invoice_status").eq("id", poId).maybeSingle();
  if (!po || po.kind === "main" || po.supplier_invoice_status === "received") return null;
  const { data: parts } = await admin.from("part_items").select("id, is_active, disposition, return_ending, removed_at").eq("po_id", poId);
  const list = ((parts ?? []) as { id: string; is_active: boolean; disposition: string | null; return_ending: string | null; removed_at: string | null }[]).map((p) => ({ id: p.id, isActive: p.is_active, disposition: p.disposition, returnEnding: p.return_ending, removed: !!p.removed_at }));
  const expected = invoiceStillExpected(list);
  const next = expected ? (po.supplier_invoice_status === "not_expected" ? "to_follow" : po.supplier_invoice_status) : "not_expected";
  if (next === po.supplier_invoice_status) return null;
  const { error } = await admin.from("purchase_orders").update({ supplier_invoice_status: next, updated_by: by.id }).eq("id", poId).neq("supplier_invoice_status", "received");
  if (error) {
    await logAppError("return-endings: invoice state", error, { staffId: by.id, detail: { poId } });
    return null;
  }
  return next === "not_expected" ? `${po.number}: no supplier invoice is expected any more (every part went back before invoicing).` : `${po.number}: waiting for the supplier invoice again.`;
}

/** The supplier credit in Zoho follows the ending: never sent for an ending with no credit; a sent one is flagged by hand. */
async function zohoAfterEnding(partId: string, ending: ReturnEndingKey, name: string, by: Actor): Promise<string> {
  if (!(NO_CREDIT_ENDINGS as string[]).includes(ending)) return "";
  const admin = createAdminClient();
  const n = await withdrawCancelled({ kind: "vendorcredit", recordId: partId }, { id: by.id, name: by.display_name });
  const { data: sent } = await admin.from("zoho_outbox").select("id, zoho_id, status").eq("kind", "vendorcredit").eq("record_id", partId).not("zoho_id", "is", null).limit(1);
  if ((sent ?? []).length) {
    await flagZohoAttention("vendorcredit", partId, `${name}: the return was corrected to "${RETURN_ENDING_LABEL[ending]}". The supplier credit already in Zoho must be voided there by hand.`, { handOnly: true });
    return " The supplier credit already in Zoho is flagged red: void it there by hand.";
  }
  return n ? " The supplier credit waiting for Zoho was withdrawn (not sent)." : "";
}

/** Exchange with no replacement yet: ONE line on the same LPO, "<name> – replaces returned <name>", at the returned cost. */
async function addReplacementLine(p: PartRow, po: Record<string, unknown>, by: Actor): Promise<{ error?: string }> {
  const admin = createAdminClient();
  const COPY = ["job_id", "part_request_id", "description", "part_number", "supplier", "part_type", "brand", "positions", "unit", "cost_aed", "list_price_aed", "discount_percent", "availability", "delivery_date", "priced_at", "priced_by", "po_id", "catalogue_id"];
  const copy = Object.fromEntries(COPY.filter((k) => k in p).map((k) => [k, p[k]]));
  const qty = Number(p.returned_qty) || Number(p.received_qty) || Number(p.quantity) || 1;
  const { data: line } = p.po_line_id ? await admin.from("purchase_order_lines").select("unit_cost").eq("id", String(p.po_line_id)).maybeSingle() : { data: null };
  const unit = Number(line?.unit_cost) || Number(p.cost_aed) || 0;
  const name = String(p.description ?? "").toUpperCase();
  const { data: rep, error } = await admin.from("part_items").insert({ ...copy, description: name, quantity: qty, confirmed_quantity: qty, received_qty: 0, cost_aed: unit, order_status: "ordered", replaced_part_id: p.id, is_active: true, created_by: by.id, updated_by: by.id }).select("id").single();
  if (error || !rep) { await logAppError("return-endings: replacement", error ?? new Error("no row"), { staffId: by.id }); return { error: SAVE_FAILED }; }
  const { data: last } = await admin.from("purchase_order_lines").select("position").eq("po_id", String(po.id)).order("position", { ascending: false }).limit(1);
  const position = (Number((last ?? [])[0]?.position) || 0) + 1;
  const { data: l, error: e2 } = await admin.from("purchase_order_lines").insert({ po_id: po.id, part_item_id: rep.id, position, description: `${name} – replaces returned ${name}`, quantity: qty, unit_cost: unit }).select("id").single();
  if (e2 || !l) { await logAppError("return-endings: replacement line", e2 ?? new Error("no row"), { staffId: by.id }); return { error: SAVE_FAILED }; }
  await admin.from("part_items").update({ po_line_id: l.id }).eq("id", rep.id);
  await admin.from("part_items").update({ replacement_part_id: rep.id }).eq("id", String(p.id));
  // The replacement is delivered and invoiced like any part: the LPO waits for it again.
  if (po.status === "received") await admin.from("purchase_orders").update({ status: "partly_received", updated_by: by.id }).eq("id", String(po.id));
  return {};
}

/** The purchase return row (if any) follows the ending. */
async function closePurchaseReturn(partId: string, ending: ReturnEndingKey, by: Actor) {
  const status = ending === "advance" ? "advance" : ending === "before_invoice" ? "before_invoice" : ending === "exchange" ? "replaced" : null;
  if (!status) return;
  const admin = createAdminClient();
  const { error } = await admin.from("purchase_returns").update({ status, closed_at: new Date().toISOString(), closed_by: by.id, updated_by: by.id }).eq("part_item_id", partId).eq("is_active", true).in("status", ["requested", "sent", "credited"]);
  if (error && !/purchase_returns/i.test(error.message)) await logAppError("return-endings: purchase return", error, { staffId: by.id, detail: { partId } });
}

export type EndingInput = { key: ReturnEndingKey; note: string; advanceAed?: number | null };

/**
 * Save how a return ended (the parts desk for advance / before invoicing / exchange; accounts and the owner for any).
 * A credit note or a refund goes through its own form (enterCreditNote / the refund on Returns and leftovers): here
 * it only records the choice when the money side is already recorded.
 */
export async function setReturnEnding(partId: string, input: EndingInput, by: Actor): Promise<{ error?: string; words?: string }> {
  if (!(await returnEndingsReady())) return { error: "Return endings are waiting for the database update (on the WAITING FOR APPLY list)." };
  const p = await partRow(partId);
  if (!p) return { error: "This part is not there any more: reload the page." };
  if (!isReturned(p)) return { error: "This part is not a return." };
  if (p.return_ending) return { error: `It already ended as "${RETURN_ENDING_LABEL[p.return_ending as ReturnEndingKey]}". Accounts or the owner can correct it.` };
  const { facts, po } = await returnFactsOf(p);
  const refusal = returnEndingRefusal(facts, by.role_id, input.key);
  if (refusal) return { error: refusal };
  if ((input.key === "credit_note" || input.key === "refund") && !facts.creditIn && p.disposition !== "returned") return { error: input.key === "credit_note" ? "Enter the supplier's credit note (\"+ Enter a credit note\"): the ending follows it." : "Record the refund on Returns and leftovers: the ending follows it." };
  return applyEnding(p, po, facts, input, by, null);
}

async function applyEnding(p: PartRow, po: Record<string, unknown> | null, facts: ReturnFacts, input: EndingInput, by: Actor, history: EndingHistoryEntry | null): Promise<{ error?: string; words?: string }> {
  const admin = createAdminClient();
  const name = String(p.description ?? "").toUpperCase();
  const now = new Date().toISOString();
  const note = input.note.trim().slice(0, 300) || null;
  const patch: Record<string, unknown> = { return_ending: input.key, return_ending_at: now, return_ending_by: by.id, return_ending_note: note, updated_by: by.id };
  // Every ending is a finished return: "returned" (the credit note awaited only for a credit note still to come).
  if (input.key !== "credit_note" || facts.creditIn) Object.assign(patch, { disposition: "returned", return_status: "returned", disposition_at: p.disposition_at ?? now, disposition_by: p.disposition_by ?? by.id });
  if (input.key === "advance") {
    const amount = round2(input.advanceAed && input.advanceAed > 0 ? Math.min(input.advanceAed, facts.paid) : Math.min(facts.value, facts.paid));
    const accounts = by.role_id === "owner" || by.role_id === "accounts";
    Object.assign(patch, { return_advance_aed: amount, return_advance_status: accounts ? "confirmed" : "asked", ...(accounts ? { return_advance_at: now, return_advance_by: by.id } : {}) });
  }
  if (history) patch.return_ending_history = [...(Array.isArray(p.return_ending_history) ? (p.return_ending_history as EndingHistoryEntry[]) : []), history];
  const { data: done, error } = await admin.from("part_items").update(patch).eq("id", String(p.id)).select("id");
  if (error || !done?.length) {
    await logAppError("return-endings: save", error ?? new Error("no row"), { staffId: by.id, detail: { partId: p.id } });
    return { error: SAVE_FAILED };
  }
  await closePurchaseReturn(String(p.id), input.key, by);
  if (input.key === "exchange" && !facts.hasReplacement && po?.id) {
    const w = await addReplacementLine(p, po, by);
    if (w.error) return { error: `The ending is saved, but the replacement line could not be added: ${w.error}` };
  }
  let extra = await zohoAfterEnding(String(p.id), input.key, name, by);
  if (po?.id) {
    const w = await refreshInvoiceExpected(String(po.id), by);
    if (w) extra += ` ${w}`;
  }
  if (input.key === "advance" && patch.return_advance_status === "confirmed") extra += await moveToAdvance(p, po, Number(patch.return_advance_aed) || 0, by);
  if (input.key === "advance" && patch.return_advance_status === "asked") {
    await notifyRoles(["accounts"], { type: "return_advance", title: `Confirm a supplier advance · ${po?.number ?? name}`, body: `${name} went back to ${po?.supplier_name ?? "the supplier"} after it was paid, with no invoice: ${aed(Number(patch.return_advance_aed) || 0)} stays with them as an advance. Confirm the amount.`, jobId: (p.job_id as string | null) ?? null, href: po?.id ? `/parts/orders/${po.id}#returns` : "/parts/returns" });
    extra += " Accounts confirm the amount.";
  }
  const jobId = (p.job_id as string | null) ?? null;
  const words = `${name}: ${RETURN_LINE_WORDS[input.key]}${history ? ` (corrected: ${history.reason})` : ""}.${extra}`;
  if (jobId) await admin.from("job_events").insert({ job_id: jobId, event_type: "purchase_return", note: `${words} (${by.display_name})`, created_by: by.id });
  return { words };
}

/**
 * Accounts confirm the advance a returned, paid part leaves with the supplier: the payment that covered the LPO gives
 * that amount back to the supplier's advance (its line on the LPO goes down; nothing is deleted, the line keeps its
 * history), so "Use the supplier's advance" offers it on their next invoice.
 */
async function moveToAdvance(p: PartRow, po: Record<string, unknown> | null, amount: number, by: Actor): Promise<string> {
  if (!po?.id || amount <= 0) return "";
  const admin = createAdminClient();
  const { data: lines } = await admin.from("supplier_payment_lines").select("id, payment_id, amount_aed").eq("po_id", String(po.id)).eq("is_active", true).order("created_at", { ascending: false });
  let left = amount;
  const touched: string[] = [];
  for (const l of (lines ?? []) as { id: string; payment_id: string; amount_aed: number | string }[]) {
    if (left <= 0.004) break;
    const has = Number(l.amount_aed) || 0;
    const take = round2(Math.min(has, left));
    const rest = round2(has - take);
    const { error } = await admin.from("supplier_payment_lines").update(rest > 0.004 ? { amount_aed: rest, updated_by: by.id } : { is_active: false, updated_by: by.id }).eq("id", l.id);
    if (error) {
      await logAppError("return-endings: advance line", error, { staffId: by.id, detail: { lineId: l.id } });
      return ` The advance could not be moved on the payment (${SAVE_FAILED})`;
    }
    const { data: pay } = await admin.from("supplier_payments").select("id, number, excess_kind, edit_history").eq("id", l.payment_id).maybeSingle();
    if (pay) {
      const hist = Array.isArray(pay.edit_history) ? pay.edit_history : [];
      const { error: payErr } = await admin.from("supplier_payments").update({ excess_kind: "advance", edit_history: [...hist, { at: new Date().toISOString(), by: by.display_name, what: `${aed(take)} of ${po.number} became an advance: ${String(p.description ?? "").toUpperCase()} returned before invoicing` }], updated_by: by.id }).eq("id", pay.id);
      if (payErr) await logAppError("return-endings: advance payment", payErr, { staffId: by.id, detail: { paymentId: pay.id } });
      touched.push(String(pay.number));
      const { data: z } = await admin.from("zoho_outbox").select("id").eq("kind", "supplierpay").eq("record_id", pay.id).not("zoho_id", "is", null).limit(1);
      if ((z ?? []).length) await flagZohoAttention("supplierpay", String(pay.id), `${aed(take)} of ${pay.number} is now an advance (a returned part on ${po.number}): unapply it from that bill in Zoho by hand.`, { handOnly: true });
    }
    left = round2(left - take);
  }
  if (!touched.length) return " No supplier payment was found on the LPO: record the money as an advance with \"Record a payment\" on the supplier.";
  return ` ${aed(round2(amount - left))} is now an advance with the supplier (${touched.join(", ")}): it is offered on their next invoice.`;
}

/** Accounts confirm (or change) the advance the parts desk asked for. */
export async function confirmReturnAdvance(partId: string, amount: number | null, by: Actor): Promise<{ error?: string; words?: string }> {
  if (!["owner", "accounts"].includes(by.role_id)) return { error: "Only accounts or the owner confirm a supplier advance." };
  if (!(await returnEndingsReady())) return { error: "Return endings are waiting for the database update." };
  const p = await partRow(partId);
  if (!p || p.return_ending !== "advance" || p.return_advance_status !== "asked") return { error: "This advance is not waiting for a confirmation." };
  const { facts, po } = await returnFactsOf(p);
  const value = round2(amount && amount > 0 ? amount : Number(p.return_advance_aed) || 0);
  if (value <= 0) return { error: "Type the amount that stays with the supplier." };
  if (value > facts.paid + 0.004) return { error: `At most ${aed(facts.paid)} was paid on ${po?.number ?? "the LPO"}.` };
  const admin = createAdminClient();
  const { data: done, error } = await admin.from("part_items").update({ return_advance_aed: value, return_advance_status: "confirmed", return_advance_at: new Date().toISOString(), return_advance_by: by.id, updated_by: by.id }).eq("id", partId).eq("return_advance_status", "asked").select("id");
  if (error || !done?.length) {
    if (error) await logAppError("return-endings: confirm advance", error, { staffId: by.id });
    return { error: error ? SAVE_FAILED : "Confirmed a moment ago by someone else." };
  }
  const extra = await moveToAdvance(p, po, value, by);
  const words = `${String(p.description ?? "").toUpperCase()}: advance of ${aed(value)} confirmed.${extra}`;
  if (p.job_id) await admin.from("job_events").insert({ job_id: p.job_id, event_type: "purchase_return", note: `${words} (${by.display_name})`, created_by: by.id });
  return { words };
}

/**
 * "Correct how this return was settled" (accounts and the owner, reason required). The return itself stays; the old
 * ending and any credit note it carried are kept in the history (voided), the new ending is applied with its effects.
 */
export async function correctReturnEnding(partId: string, input: EndingInput & { reason: string }, by: Actor): Promise<{ error?: string; words?: string }> {
  if (!["owner", "accounts"].includes(by.role_id)) return { error: "Only accounts or the owner correct how a return was settled." };
  if (!(await returnEndingsReady())) return { error: "Return endings are waiting for the database update (on the WAITING FOR APPLY list)." };
  const reason = input.reason.trim();
  if (reason.length < 5) return { error: "Write why it is corrected (5 characters at least)." };
  const p = await partRow(partId);
  if (!p || !isReturned(p)) return { error: "This part is not a return." };
  const { facts, po } = await returnFactsOf(p);
  const from = legacyEndingOf(p as never);
  if (from === input.key && !(input.key === "credit_note" && !facts.invoiced)) return { error: "It already ends that way." };
  // The credit note recorded under the old ending is voided (kept in the history), so it no longer counts.
  const hadCredit = from === "credit_note" && input.key !== "credit_note";
  const voided = hadCredit ? { creditNote: (p.credit_note_number as string | null) ?? (p.disposition_note as string | null) ?? null, amount: Number(p.credit_note_amount_aed) || null, note: (p.disposition_note as string | null) ?? null } : undefined;
  const corrected: ReturnFacts = { ...facts, creditIn: hadCredit ? false : facts.creditIn };
  const refusal = returnEndingRefusal(corrected, by.role_id, input.key);
  if (refusal) return { error: refusal };
  const admin = createAdminClient();
  if (hadCredit) {
    const { error } = await admin.from("part_items").update({ credit_note_number: null, credit_note_amount_aed: null, credit_note_date: null, disposition_note: `Credit note voided (${voided?.creditNote ?? ""}) – ${reason}`.slice(0, 300), updated_by: by.id }).eq("id", partId);
    if (error) {
      await logAppError("return-endings: void credit", error, { staffId: by.id });
      return { error: SAVE_FAILED };
    }
    await admin.from("purchase_returns").update({ status: input.key === "advance" ? "advance" : input.key === "before_invoice" ? "before_invoice" : "replaced", credit_number: null, credit_net_aed: null, credit_vat_aed: null, updated_by: by.id }).eq("part_item_id", partId).eq("status", "credited");
  }
  const history: EndingHistoryEntry = { at: new Date().toISOString(), by: by.display_name, from, to: input.key, reason, ...(voided ? { voided } : {}) };
  // Clear the old stored ending so applyEnding writes the new one in full.
  return applyEnding({ ...p, return_ending: null, credit_note_number: hadCredit ? null : p.credit_note_number }, po, corrected, input, by, history);
}

/** The returned-before-invoicing parts of an LPO (the warning when an invoice is typed later). */
export async function returnedBeforeInvoiceOn(poId: string): Promise<string[]> {
  if (!(await returnEndingsReady())) return [];
  const { data } = await createAdminClient().from("part_items").select("description").eq("po_id", poId).in("return_ending", ["before_invoice", "advance"]);
  return ((data ?? []) as { description: string }[]).map((p) => p.description);
}

/** Advances the parts desk asked for, waiting for accounts (Waiting on you). */
export async function advancesToConfirm(): Promise<{ partId: string; name: string; amount: number; poId: string | null; poNumber: string | null; supplier: string | null; jobId: string | null }[]> {
  if (!(await returnEndingsReady())) return [];
  const admin = createAdminClient();
  const { data } = await admin.from("part_items").select("id, description, return_advance_aed, po_id, job_id").eq("return_ending", "advance").eq("return_advance_status", "asked").limit(100);
  const list = (data ?? []) as { id: string; description: string; return_advance_aed: number | string | null; po_id: string | null; job_id: string | null }[];
  const poIds = Array.from(new Set(list.map((p) => p.po_id).filter((x): x is string => !!x)));
  const { data: pos } = poIds.length ? await admin.from("purchase_orders").select("id, number, supplier_name").in("id", poIds) : { data: [] };
  const poOf = new Map(((pos ?? []) as { id: string; number: string; supplier_name: string }[]).map((p) => [p.id, p]));
  return list.map((p) => ({ partId: p.id, name: p.description.toUpperCase(), amount: Number(p.return_advance_aed) || 0, poId: p.po_id, poNumber: p.po_id ? (poOf.get(p.po_id)?.number ?? null) : null, supplier: p.po_id ? (poOf.get(p.po_id)?.supplier_name ?? null) : null, jobId: p.job_id }));
}

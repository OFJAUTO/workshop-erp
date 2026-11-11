import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { aed, rowEffect, type EffectFacts, type RowEffect } from "@/lib/zoho-sync-rules";
import { billErpFigures, poForZoho, type ZohoKind } from "@/lib/zoho-sync";
import { chunks } from "@/lib/page-all";
import { returnCreditOf } from "@/lib/part-endings";
import { schemaReady } from "@/lib/schema-ready";

/**
 * One document behind an outbox row: its name for people ("INV-00012 · AED 1,050.00"), its ERP amount, and what sending
 * the row does to the books (rowEffect: a first post, a look again at something already in Zoho, a removal from Zoho,
 * or nothing at all) with the words for it.
 */
export type OutboxDoc = { name: string; amount: number | null; effect: RowEffect; effectWords: string | null };

const round2 = (n: number) => Math.round(n * 100) / 100;
const OUR_STOCK = /^our stock$/i;

/**
 * THE lookup of the documents behind outbox rows (3 November 2026), batched per kind: the sync page's list, the Sync to
 * Zoho preview, the results list and the daily reminder all read it, so the names, amounts and effects agree
 * everywhere. The amount is the ERP's own figure for what goes to Zoho: an invoice's total with VAT, a payment's
 * amount, a supplier bill as THE bill computation (billErpFigures, the same one the sync and the reconciliation use), a
 * settlement's gross. Customers and suppliers carry a name only. Keyed "<kind>:<record id>".
 *
 * The effect (review of 3 November 2026) follows the facts each handler reads first — the document's own Zoho id, a
 * void or cancellation, a document that never goes to Zoho — so a receipt voided before the press is "nothing goes",
 * a receipt voided after it posted is "taken back out of Zoho", and a late proof on a posted voucher is "already in
 * Zoho": none of them is counted as new money in the preview. A row whose outbox entry carries a Zoho id (reopened
 * after it posted) is "already in Zoho" unless the document itself is voided.
 */
export async function outboxDocs(rows: { kind: ZohoKind; record_id: string; zoho_id?: string | null }[], opts: { billFigures?: boolean } = {}): Promise<Map<string, OutboxDoc>> {
  const admin = createAdminClient();
  const docs = new Map<string, OutboxDoc>();
  const outboxInZoho = new Set(rows.filter((r) => r.zoho_id).map((r) => `${r.kind}:${r.record_id}`));
  const idsOf = (...kinds: ZohoKind[]) => Array.from(new Set(rows.filter((r) => kinds.includes(r.kind)).map((r) => r.record_id)));
  const each = async <T,>(table: string, select: string, ids: string[], fn: (row: T) => void) => {
    for (const part of chunks(ids)) {
      const { data } = await admin.from(table).select(select).in("id", part);
      for (const r of (data ?? []) as T[]) fn(r);
    }
  };
  /** One entry: the facts give the effect; the outbox row's own Zoho id counts as "in Zoho" unless the document is gone. */
  const put = (key: string, name: string, amount: number | null, facts: EffectFacts) => {
    const e = rowEffect({ ...facts, inZoho: facts.inZoho || (!facts.gone && outboxInZoho.has(key)) });
    docs.set(key, { name, amount, effect: e.effect, effectWords: e.words });
  };

  type InvoiceDocRow = { id: string; number: string; kind: string; status: string; total_aed: number | string; refund_amount_aed: number | string | null; deposit_for_quotation_id: string | null; zoho_invoice_id: string | null; zoho_creditnote_id: string | null; zoho_refund_id: string | null };
  await each<InvoiceDocRow>(
    "invoices",
    "id, number, kind, status, total_aed, refund_amount_aed, deposit_for_quotation_id, zoho_invoice_id, zoho_creditnote_id, zoho_refund_id",
    idsOf("invoice", "creditnote", "cnrefund"),
    (i) => {
      const total = round2(Number(i.total_aed) || 0);
      const cancelled = i.status === "cancelled";
      put(`invoice:${i.id}`, `${i.number} · ${aed(total)}`, total, {
        inZoho: !!i.zoho_invoice_id,
        gone: cancelled,
        notForZoho: i.kind !== "tax_invoice" ? "only tax invoices go to Zoho" : i.deposit_for_quotation_id ? "a deposit document (the advance itself goes as a payment)" : null,
      });
      put(`creditnote:${i.id}`, `${i.number} · ${aed(total)}`, total, { inZoho: !!i.zoho_creditnote_id, gone: cancelled, notForZoho: i.kind !== "credit_note" ? "not a credit note" : null });
      const refund = round2(Number(i.refund_amount_aed ?? i.total_aed) || 0);
      put(`cnrefund:${i.id}`, `${i.number} · ${aed(refund)}`, refund, { inZoho: !!i.zoho_refund_id, notForZoho: i.kind !== "credit_note" ? "not a credit note" : null });
    },
  );
  await each<{ id: string; number: string; amount_aed: number | string; method: string | null; status: string; zoho_payment_id: string | null }>(
    "payments",
    "id, number, amount_aed, method, status, zoho_payment_id",
    idsOf("deposit", "payment"),
    (p) => {
      const amount = round2(Number(p.amount_aed) || 0);
      const name = `${p.number} · ${aed(amount)}${p.method ? ` · ${p.method}` : ""}`;
      // A receipt voided (or reversed) in the ERP: before it reached Zoho nothing goes; after, the run removes it.
      const facts: EffectFacts = { inZoho: !!p.zoho_payment_id, gone: p.status === "voided" || p.status === "reversed", removable: true };
      put(`deposit:${p.id}`, name, amount, facts);
      put(`payment:${p.id}`, name, amount, facts);
    },
  );
  await each<{ id: string; full_name: string | null; company_name: string | null; zoho_contact_id: string | null }>("customers", "id, full_name, company_name, zoho_contact_id", idsOf("contact"), (c) =>
    put(`contact:${c.id}`, String(c.company_name || c.full_name || "Customer"), null, { inZoho: !!c.zoho_contact_id }),
  );
  await each<{ id: string; name: string; zoho_vendor_id: string | null }>("suppliers", "id, name, zoho_vendor_id", idsOf("vendor"), (s) => put(`vendor:${s.id}`, String(s.name), null, { inZoho: !!s.zoho_vendor_id }));

  // Supplier bills and their payments. The preview and the results ask for THE bill figure (delivered quantities, the
  // typed invoice amount, VAT by the supplier's standing: a few reads per bill); the long page list needs the name only.
  type PoFacts = { id: string; number: string; kind: string; supplier_name: string; supplier_invoice_number: string | null; supplier_paid_at: string | null; zoho_bill_id: string | null; zoho_billpayment_id: string | null };
  const putPo = (po: PoFacts, gross: number | null) => {
    const internal = OUR_STOCK.test(po.supplier_name.trim()) ? "an Our-stock LPO is internal (our own shelf)" : null;
    const money = gross == null ? "" : ` · ${aed(gross)}`;
    put(`bill:${po.id}`, `${po.supplier_invoice_number ?? po.number} · ${po.supplier_name}${money}`, gross, {
      inZoho: !!po.zoho_bill_id,
      notForZoho: po.kind === "main" ? "a main LPO (the bills sit on its supplier LPOs)" : internal,
    });
    // "Paid to supplier" taken back in the ERP: before it reached Zoho nothing goes; after, the run removes it.
    // Fix 3 (4 November 2026, Mathew): a supplier payment names its supplier AND the bill it pays.
    put(`billpayment:${po.id}`, `${po.number} · ${po.supplier_name}${po.supplier_invoice_number ? ` · bill ${po.supplier_invoice_number}` : ""}${money}`, gross, { inZoho: !!po.zoho_billpayment_id, gone: !po.supplier_paid_at, removable: true, notForZoho: internal });
  };
  const poIds = idsOf("bill", "billpayment");
  if (opts.billFigures) {
    await Promise.all(
      poIds.map(async (id) => {
        try {
          const po = await poForZoho(id);
          putPo(po, (await billErpFigures(po)).gross);
        } catch {
          // The LPO is gone: the row says so when it is sent; here it simply has no name or amount.
        }
      }),
    );
  } else {
    await each<PoFacts>("purchase_orders", "id, number, kind, supplier_name, supplier_invoice_number, supplier_paid_at, zoho_bill_id, zoho_billpayment_id", poIds, (po) => putPo(po, null));
  }
  // Supplier payments with their amount (6 November 2026): one payment, its invoices, any advance or fee.
  await each<{ id: string; number: string; supplier_name: string; amount_aed: number | string; status: string; zoho_payment_id: string | null }>("supplier_payments", "id, number, supplier_name, amount_aed, status, zoho_payment_id", idsOf("supplierpay"), (p) => {
    const amount = round2(Number(p.amount_aed) || 0);
    put(`supplierpay:${p.id}`, `${p.number} · ${p.supplier_name} · ${aed(amount)}`, amount, { inZoho: !!p.zoho_payment_id, notForZoho: p.status === "void" ? "the payment was voided in the ERP" : null });
  });
  // Combined payments (one cheque for several cars) and month-end lathe bills (9 November 2026).
  await each<{ id: string; number: string; amount_aed: number | string; is_active: boolean; zoho_payment_id: string | null }>("payment_groups", "id, number, amount_aed, is_active, zoho_payment_id", idsOf("paygroup"), (g) => {
    const amount = round2(Number(g.amount_aed) || 0);
    put(`paygroup:${g.id}`, `${g.number} · combined payment · ${aed(amount)}`, amount, { inZoho: !!g.zoho_payment_id, notForZoho: null });
  });
  await each<{ id: string; bill_number: string; supplier_name: string; total_aed: number | string; is_active: boolean; zoho_bill_id: string | null }>("lathe_bills", "id, bill_number, supplier_name, total_aed, is_active, zoho_bill_id", idsOf("lathebill"), (b) => {
    const amount = round2(Number(b.total_aed) || 0);
    put(`lathebill:${b.id}`, `Lathe bill ${b.bill_number} · ${b.supplier_name} · ${aed(amount)}`, amount, { inZoho: !!b.zoho_bill_id, notForZoho: null });
  });
  // A further supplier invoice on an LPO (10 November 2026, Section 3): its own bill, with VAT as printed (else 5%).
  await each<{ id: string; number: string; supplier_name: string; amount_aed: number | string; vat_aed: number | string | null; is_active: boolean; zoho_bill_id: string | null }>("lpo_invoices", "id, number, supplier_name, amount_aed, vat_aed, is_active, zoho_bill_id", idsOf("lpoinvoice"), (b) => {
    const net = round2(Number(b.amount_aed) || 0);
    const amount = round2(net + (b.vat_aed === null ? round2(net * 0.05) : round2(Number(b.vat_aed) || 0)));
    put(`lpoinvoice:${b.id}`, `Supplier invoice ${b.number} · ${b.supplier_name} · ${aed(amount)}`, amount, { inZoho: !!b.zoho_bill_id, notForZoho: b.is_active === false ? "the invoice was taken off the LPO" : null });
  });
  await each<{ id: string; number: string; recipient: string; amount_aed: number | string; is_active: boolean; zoho_expense_id: string | null }>("commission_payments", "id, number, recipient, amount_aed, is_active, zoho_expense_id", idsOf("commission"), (v) => {
    const amount = round2(Number(v.amount_aed) || 0);
    put(`commission:${v.id}`, `${v.number} · ${v.recipient} · ${aed(amount)}`, amount, { inZoho: !!v.zoho_expense_id, notForZoho: v.is_active === false ? "the voucher is inactive in the ERP" : null });
  });
  await each<{ id: string; who: string; month: string; total_aed: number | string; zoho_expense_id: string | null }>("recovery_payouts", "id, who, month, total_aed, zoho_expense_id", idsOf("recovery"), (r) => {
    const amount = round2(Number(r.total_aed) || 0);
    put(`recovery:${r.id}`, `${r.month} · ${r.who} · ${aed(amount)}`, amount, { inZoho: !!r.zoho_expense_id });
  });
  type PartDocRow = { id: string; description: string; supplier: string | null; quantity: number | string; confirmed_quantity: number | string | null; received_qty: number | string | null; returned_qty: number | string | null; cost_aed: number | string | null; final_cost_aed: number | string | null; po_line_id: string | null; disposition: string | null; zoho_vendorcredit_id: string | null; credit_note_amount_aed?: number | string | null };
  const creditIds = idsOf("vendorcredit");
  if (creditIds.length) {
    // The supplier credit note's own amount, once migration 20261203140000_part_endings is applied (the handler reads it too).
    const typedAmount = await schemaReady("part_items", "credit_note_amount_aed");
    const parts: PartDocRow[] = [];
    await each<PartDocRow>(
      "part_items",
      `id, description, supplier, quantity, confirmed_quantity, received_qty, returned_qty, cost_aed, final_cost_aed, po_line_id, disposition, zoho_vendorcredit_id${typedAmount ? ", credit_note_amount_aed" : ""}`,
      creditIds,
      (pt) => parts.push(pt),
    );
    const lines = new Map<string, { unit_cost: number | string | null; invoice_unit_cost: number | string | null }>();
    await each<{ id: string; unit_cost: number | string | null; invoice_unit_cost: number | string | null }>(
      "purchase_order_lines",
      "id, unit_cost, invoice_unit_cost",
      Array.from(new Set(parts.map((p) => p.po_line_id).filter((x): x is string => !!x))),
      (l) => lines.set(l.id, l),
    );
    const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
    for (const pt of parts) {
      // The same quantity and amount the supplier-credit handler posts (before VAT): THE credit rule returnCreditOf
      // (typed credit note amount, else the invoice price on its LPO line, else the LPO price, else the part's cost).
      const qty = Number(pt.returned_qty) || Number(pt.received_qty) || Number(pt.confirmed_quantity) || Number(pt.quantity) || 0;
      const line = pt.po_line_id ? lines.get(pt.po_line_id) : undefined;
      const amount = returnCreditOf({ qty, creditNoteAmount: numOrNull(pt.credit_note_amount_aed), invoiceUnit: numOrNull(line?.invoice_unit_cost), lineUnit: numOrNull(line?.unit_cost), finalCost: numOrNull(pt.final_cost_aed), cost: numOrNull(pt.cost_aed) }).amount;
      put(`vendorcredit:${pt.id}`, `${pt.description}${pt.supplier ? ` · ${pt.supplier}` : ""} · ${aed(amount)} before VAT`, amount, {
        inZoho: !!pt.zoho_vendorcredit_id,
        notForZoho: pt.disposition !== "returned" ? "the part is not recorded as returned to the supplier" : pt.supplier && OUR_STOCK.test(pt.supplier.trim()) ? "returned to our own shelf" : null,
      });
    }
  }
  await each<{ id: string; number: string; method: string; gross_aed: number | string; is_active: boolean; zoho_transfer_id: string | null; zoho_fee_id: string | null }>(
    "card_settlements",
    "id, number, method, gross_aed, is_active, zoho_transfer_id, zoho_fee_id",
    idsOf("settlement"),
    (st) => {
      const amount = round2(Number(st.gross_aed) || 0);
      // An undone settlement: before it reached Zoho nothing goes; after, it turns red to be removed in Zoho by hand.
      put(`settlement:${st.id}`, `${st.number} · ${st.method === "card" ? "card machine" : "payment link"} · ${aed(amount)}`, amount, { inZoho: !!(st.zoho_transfer_id || st.zoho_fee_id), gone: st.is_active === false });
    },
  );
  return docs;
}

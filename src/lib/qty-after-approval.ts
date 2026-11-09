import "server-only";
import { dbWords, logAppError } from "./app-errors";
import { createAdminClient } from "./supabase/admin";
import { notifyRoles, notifyStaff, jobAdvisorIds } from "./notifications";
import { formatDateTime } from "./format";
import { cleanUnit, qtyWithUnit, type PartUnit } from "./part-units";
import { QTY_REASONS, qtyChangeLine, qtyDirection, roundQty, type QtyReason } from "./qty-after-approval-rules";
import { partUnitsReady } from "./schema-ready";

/*
 * Section 1 of 9 November 2026 (the BMW REAR DIFFERENTIAL OIL, quoted 3, bought and used 2): the parts desk and the
 * owner change the quantity of a part that is already approved, ordered, received or handed over, until the job's tax
 * invoice is issued. THE function is changeApprovedQuantity:
 *   - the part takes the quantity (our cost follows: the part's cost is per unit), the history says
 *     "REAR DIFFERENTIAL OIL: 3 → 2 by Peter, 9 Nov 14:05: bought fewer";
 *   - its LPO line takes it too (total re-counted, the LPO's notes keep the change); a supplier invoice already
 *     entered with the old quantity is flagged for accounts (never changed from here);
 *   - a live proforma's line cost follows (job profit is right at once);
 *   - pieces received but no longer needed go to stock or to a purchase return (the caller says which);
 *   - DOWN: the advisor is told "Reduce the customer's price to match" (the card on the quotation, qty-reduce.ts);
 *     UP: the existing re-approval flow (the quotation line follows its part: a revision for the owner to allow).
 * After the tax invoice nothing is edited: the answer offers "Credit note for the difference".
 */

export type QtyActor = { id: string; display_name: string; role_id: string };
export type QtyAnswer = { error?: string; ok?: boolean; words?: string; direction?: "down" | "up"; creditNoteHref?: string; extras?: number; needsExtras?: number; advisorTold?: boolean };

const PART_COLS = "id, job_id, description, quantity, confirmed_quantity, received_qty, cost_aed, final_cost_aed, order_status, is_active, po_id, po_line_id, supplier, part_number, removed_at, disposition";

/** A live tax invoice on the job (never a deposit invoice): no quantity change any more. */
export async function liveTaxInvoiceOf(jobId: string): Promise<{ id: string; number: string } | null> {
  const { data } = await createAdminClient().from("invoices").select("id, number").eq("job_id", jobId).eq("kind", "tax_invoice").eq("status", "issued").eq("is_active", true).is("deposit_for_quotation_id", null).order("issued_at", { ascending: false }).limit(1).maybeSingle();
  return (data as { id: string; number: string } | null) ?? null;
}

export async function changeApprovedQuantity(jobId: string, partId: string, input: { qty: number; reason: QtyReason | string; note?: string | null; extras?: "stock" | "return" | null }, by: QtyActor): Promise<QtyAnswer> {
  if (!["owner", "parts"].includes(by.role_id)) return { error: "Only the parts desk or the owner can change the quantity of an approved part." };
  const admin = createAdminClient();
  const unitsReady = await partUnitsReady();
  const { data: raw } = await admin.from("part_items").select(`${PART_COLS}${unitsReady ? ", unit" : ""}`).eq("id", partId).eq("job_id", jobId).maybeSingle();
  const p = raw as unknown as { id: string; job_id: string; description: string; quantity: number | string; confirmed_quantity: number | string | null; received_qty: number | string | null; cost_aed: number | string | null; final_cost_aed: number | string | null; order_status: string; is_active: boolean; po_id: string | null; po_line_id: string | null; supplier: string | null; part_number: string | null; removed_at: string | null; disposition: string | null; unit?: string | null } | null;
  if (!p || !p.is_active || p.removed_at || p.disposition) return { error: "That part is no longer on the job." };
  const name = String(p.description).toUpperCase();
  const reasonKey = String(input.reason ?? "").trim();
  const reasonWords = (QTY_REASONS.find((r) => r.key === reasonKey)?.words ?? reasonKey).trim();
  if (reasonWords.length < 3) return { error: "Say why the quantity changed (bought fewer, used fewer, supplier short, returned)." };
  const unit: PartUnit = cleanUnit(p.unit) ?? "pc";
  const now = roundQty(Number(input.qty), unit);
  if (!(now > 0)) return { error: `${name}: the quantity must be above 0. If none is needed, use Remove: not needed.` };
  if (unit !== "l" && Math.abs(now - Math.round(now)) > 1e-9) return { error: `${name}: whole pieces only.` };
  const was = Number(p.confirmed_quantity ?? p.quantity) || 1;
  if (Math.abs(was - now) < 0.005) return { error: `${name} is already ${qtyWithUnit(now, unit)}.` };
  const direction = qtyDirection(was, now);

  const tax = await liveTaxInvoiceOf(jobId);
  if (tax) {
    const { creditNoteFor } = await import("./qty-reduce");
    const cn = direction === "down" ? await creditNoteFor(jobId, p.id, was, now) : null;
    const href = `/invoices/${tax.id}?cn_note=${encodeURIComponent(`${name}: ${qtyWithUnit(was, unit)} invoiced, ${qtyWithUnit(now, unit)} used`)}${cn ? `&cn_amount=${cn.toFixed(2)}` : ""}#credit-notes`;
    return { error: `${tax.number} is already issued, so the quantity can no longer change. ${direction === "down" ? "Give a credit note for the difference instead." : "Any extra pieces go on a new quotation."}`, creditNoteHref: direction === "down" ? href : undefined };
  }

  // Pieces already here beyond the new quantity: to stock or back to the supplier (the caller must say which).
  const received = Number(p.received_qty) || 0;
  const extras = Math.max(0, roundQty(received - now, unit));
  if (extras > 0 && input.extras !== "stock" && input.extras !== "return") return { error: `${qtyWithUnit(extras, unit)} of ${name} ${extras === 1 ? "was" : "were"} received and not needed. Choose: to stock or a purchase return.`, needsExtras: extras };

  const at = new Date();
  const line = qtyChangeLine({ name, was, now, unit, by: by.display_name, when: formatDateTime(at.toISOString()), reason: reasonWords, note: input.note ?? null });
  const patch: Record<string, unknown> = { confirmed_quantity: now, quantity_changed_at: at.toISOString(), quantity_changed_by: by.id, updated_by: by.id };
  if (extras > 0) patch.received_qty = now;
  // A part fully here again after the change (fewer needed than received, or exactly what arrived) reads Received.
  if (received > 0 && received - extras >= now - 1e-9 && ["partly_received", "ordered"].includes(p.order_status)) patch.order_status = "received";
  const { error } = await admin.from("part_items").update(patch).eq("id", p.id).eq("is_active", true);
  if (error) return { error: dbWords(error, "lib/qty-after-approval") };

  // From here every step is logged on failure and never undoes the change (the history says what happened).
  const unitCost = Number(p.final_cost_aed ?? p.cost_aed) || 0;
  await admin.from("job_events").insert({ job_id: jobId, event_type: "parts_quantity", note: line, created_by: by.id });

  // The LPO line follows; a supplier invoice already entered with the old quantity is flagged for accounts.
  let lpoWords = "";
  if (p.po_line_id && p.po_id) {
    try {
      const { data: po } = await admin.from("purchase_orders").select("id, number, status, notes, supplier_invoice_status, supplier_invoice_number, job_id").eq("id", p.po_id).maybeSingle();
      if (po) {
        const invoiced = po.supplier_invoice_status === "received";
        const note = `${line}${invoiced ? ` – the supplier invoice ${po.supplier_invoice_number ?? ""} was entered with ${qtyWithUnit(was, unit)}` : ""}`.replace(/\s+–/, " –");
        if (!invoiced) await admin.from("purchase_order_lines").update({ quantity: now, ...(extras > 0 ? { received_qty: now } : {}), updated_by: by.id }).eq("id", p.po_line_id);
        await admin.from("purchase_orders").update({ notes: [String(po.notes ?? "").trim(), note].filter(Boolean).join("\n"), updated_by: by.id }).eq("id", po.id);
        if (!invoiced) {
          const { retotalPo } = await import("./lpo");
          await retotalPo(po.id as string, by.id);
        } else {
          await notifyRoles(["accounts"], { type: "qty_after_invoice", title: `Quantity changed after the supplier invoice · ${po.number}`, body: `${line}. ${po.supplier_invoice_number ?? "The supplier invoice"} still shows ${qtyWithUnit(was, unit)} × AED ${unitCost.toFixed(2)}: check it with the supplier (credit note or corrected invoice).`, jobId, href: `/parts/orders/${po.id}` });
        }
        lpoWords = ` ${po.number} ${invoiced ? "keeps the entered invoice; accounts are told" : `now ${qtyWithUnit(now, unit)}`}.`;
      }
    } catch (e) {
      await logAppError("qty-after-approval: lpo", e, { staffId: by.id, jobId });
    }
  }

  // A live proforma's internal cost of the part follows (the customer's price changes only with the advisor's choice).
  try {
    const { data: pro } = await admin.from("invoices").select("id").eq("job_id", jobId).eq("kind", "proforma").eq("status", "issued").eq("is_active", true).is("converted_to", null).is("deposit_for_quotation_id", null);
    const ids = ((pro ?? []) as { id: string }[]).map((x) => x.id);
    if (ids.length) await admin.from("invoice_lines").update({ cost_aed: Math.round(unitCost * now * 100) / 100, updated_by: by.id }).in("invoice_id", ids).eq("part_item_id", p.id).eq("is_active", true);
  } catch (e) {
    await logAppError("qty-after-approval: proforma cost", e, { staffId: by.id, jobId });
  }

  // Extra pieces received.
  let extrasWords = "";
  if (extras > 0) {
    try {
      if (input.extras === "stock") {
        const { addPartToStock } = await import("./stock");
        const r = await addPartToStock({ id: p.id, description: p.description, part_number: p.part_number, cost_aed: unitCost, quantity: extras, confirmed_quantity: extras, supplier: p.supplier, unit }, { id: by.id, display_name: by.display_name }, jobId);
        extrasWords = r.error ? ` The ${qtyWithUnit(extras, unit)} left over could not go to stock: ${r.error}` : ` ${qtyWithUnit(extras, unit)} left over went to stock${r.itemName ? ` (${r.itemName})` : ""}.`;
      } else {
        const { openPurchaseReturn } = await import("./purchase-returns");
        const number = await openPurchaseReturn(p.id, `${reasonWords}: ${qtyWithUnit(extras, unit)} not needed`, { id: by.id, display_name: by.display_name }, { quantity: extras });
        extrasWords = number ? ` ${qtyWithUnit(extras, unit)} left over: purchase return ${number} opened.` : ` ${qtyWithUnit(extras, unit)} left over: open the purchase return from Returns and leftovers.`;
      }
    } catch (e) {
      await logAppError("qty-after-approval: extras", e, { staffId: by.id, jobId });
    }
  }

  // The quotation: down = the advisor's choice (Reduce the customer's price, the default); up = the re-approval flow.
  let advisorTold = false;
  const { data: job } = await admin.from("jobs").select("id, job_number").eq("id", jobId).maybeSingle();
  const jobNumber = (job?.job_number as string | undefined) ?? "";
  try {
    const { approvedLineOfPart } = await import("./qty-reduce");
    const approved = await approvedLineOfPart(jobId, p.id);
    if (direction === "down" && approved && approved.quantity > now + 1e-9) {
      await notifyStaff(await jobAdvisorIds(jobId), { type: "qty_reduced", title: `Reduce the customer's price · ${jobNumber}`, body: `${line}. Open ${approved.number} and press "Reduce the customer's price to match" (no customer approval needed).`, jobId, href: `/jobs/${jobId}/quote/${approved.quotationId}#qty-reduce` });
      advisorTold = true;
    } else if (direction === "up") {
      const { syncPartLine } = await import("./quote-versions");
      await syncPartLine(jobId, p.id, by.id);
    }
  } catch (e) {
    await logAppError("qty-after-approval: quotation", e, { staffId: by.id, jobId });
  }

  return { ok: true, direction, words: `${line}.${lpoWords}${extrasWords}${direction === "down" ? (advisorTold ? " The advisor is told to reduce the customer's price." : "") : " The quotation goes back for approval (the existing revision flow)."}`.replace(/\.\./g, "."), extras };
}

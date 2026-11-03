import "server-only";
import { logAppError, SAVE_FAILED } from "./app-errors";
import { finishPartsPlanning, refusalsReady } from "./lpo";
import { round2 } from "./money";
import { jobAdvisorIds, notifyManagers, notifyRoles, notifyStaff } from "./notifications";
import { PART_FULL_SELECT, toPartFull, type PartFull } from "./parts-data";
import { realPartNumber } from "./parts-rows";
import { ENDING_LABEL, LINE_ENDING_LABEL, deliveredQty, endingOf, endingRefusal, endingWords, fromOurShelf, notDeliveredQty, poAfterEnding, returnCreditOf, stateOfChoice, storedDisposition, supplierMessage, type EndingKey, type EndingPart, type EndingState } from "./part-endings";
import { schemaReady } from "./schema-ready";
import { addPartToStock, recordStockMovement } from "./stock";
import { createAdminClient } from "./supabase/admin";
import { tryEnqueueZoho } from "./zoho-sync";

/**
 * THE way an ordered part that is not needed gets its ending (3 November 2026, section 7). One function for the Parts
 * table's "Remove: not needed", the Returns and leftovers list, the handover page's "Parts without a home" and the
 * parts a revised or declined quotation dropped. The rules are pure in part-endings.ts.
 *
 * Everything is checked before anything is written; a refusal writes nothing and says why in plain words. Then, step by
 * step, every database answer checked: the part (claimed, so two people never end it twice), its LPO line (cancelled,
 * or cut to what arrived), the LPO (total and status), a live proforma's internal cost of it (0: the tax invoice it
 * becomes copies that), the stock (Keep in stock). A step that fails puts the earlier steps back, writes the technical
 * error to app_errors and answers SAVE_FAILED - never a half-done ending, never silent. After that, nothing can undo
 * the ending: the quotation (the one that charges the part, never another of the job; never touched once the customer
 * approved it: the advisor is told to revise and the owner is asked to allow it, or - a tax invoice out - the owner
 * settles it with a credit note), the notices and the plan follow, and their failures are only logged.
 */

/** Migration 20261203140000_part_endings: the credit-note columns and the two new disposition values. */
export const partEndingsReady = () => schemaReady("part_items", "credit_note_number, credit_note_amount_aed, credit_note_date, credit_note_at, credit_note_by");

export type EndActor = { id: string; display_name: string; role_id: string };
export type CreditNoteInput = { number: string | null; path: string | null; amount: number | null; date: string | null };
export type EndInput = { ending: EndingKey; reason: string; creditNote?: CreditNoteInput | null };
export type EndResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  state?: EndingState;
  /** "Removed – Cancelled with the supplier by Omar": the row's new label, shown at once. */
  words?: string;
  /** What the supplier must be told, ready to copy (a cancelled line on an ordered LPO, a return). */
  supplierCopy?: { supplier: string; text: string } | null;
  /** The part was on a quotation the customer approved: what happens to the price (nothing until the advisor revises). */
  quoteNote?: string | null;
};

type Part = PartFull & { stock_item_id: string | null; refused_at?: string | null; pending_handover_id?: string | null };
type Line = { id: string; po_id: string; quantity: number; received_qty: number; unit_cost: number; invoice_unit_cost: number | null; is_active: boolean; part_number: string | null; description: string };
type Po = { id: string; number: string; kind: string | null; status: string; supplier_name: string; notes: string | null; total_cost_aed: number; received_at: string | null; job_id: string | null; supplier_invoice_status: string | null };

const cleanText = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const aedText = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dubaiDay = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);

/** The part's line on the NEWEST version of its quotation number (an older version's line is history, never a target). */
async function newestQuoteLineOf(jobId: string, partId: string): Promise<{ quotationId: string; number: string; version: number; status: string; lineTotal: number } | null> {
  const admin = createAdminClient();
  const [{ data: lines, error: le }, { data: qs, error: qe }] = await Promise.all([
    admin.from("quotation_lines").select("quotation_id, line_total").eq("part_item_id", partId).eq("is_active", true),
    admin.from("quotations").select("id, number, version, status").eq("job_id", jobId).eq("kind", "quotation").eq("is_active", true),
  ]);
  if (le || qe) throw le ?? qe;
  const newest = new Map<string, { id: string; version: number; status: string }>();
  for (const q of qs ?? []) {
    const cur = newest.get(q.number as string);
    if (!cur || Number(q.version) > cur.version) newest.set(q.number as string, { id: q.id as string, version: Number(q.version), status: q.status as string });
  }
  for (const l of lines ?? []) {
    for (const [number, v] of newest) {
      if (v.id !== l.quotation_id || ["cancelled", "superseded", "declined", "expired"].includes(v.status)) continue;
      return { quotationId: v.id, number, version: v.version, status: v.status, lineTotal: Number(l.line_total) || 0 };
    }
  }
  return null;
}

/**
 * The ending, from the screen's answer to the plain-words result (see the top). The caller has checked who may do it
 * (Parts or the owner, never View as).
 */
export async function endOrderedPart(jobId: string, partId: string, input: EndInput, actor: EndActor): Promise<EndResult> {
  const reason = cleanText(input.reason, 300);
  if (reason.length < 3) return { error: "Say why the part is not needed (a few words)." };
  if (input.ending !== "cancelled" && input.ending !== "return" && input.ending !== "stock") return { error: "Choose an ending: Cancelled with the supplier, Return to supplier, or Keep in stock." };
  const admin = createAdminClient();
  const fail = async (step: string, err: unknown): Promise<EndResult> => {
    await logAppError("end_part", err, { staffId: actor.id, jobId, detail: { partId, ending: input.ending, step } });
    return { error: SAVE_FAILED };
  };
  try {
    const [refusedCol, ready] = await Promise.all([refusalsReady(), partEndingsReady()]);
    /* ---------- 1. Read, and check everything before writing anything ---------- */
    const { data: raw, error: readErr } = await admin.from("part_items").select(`${PART_FULL_SELECT}, stock_item_id, pending_handover_id${refusedCol ? ", refused_at" : ""}`).eq("id", partId).eq("job_id", jobId).maybeSingle();
    if (readErr) return fail("read the part", readErr);
    if (!raw) return { error: "This part is not on this job any more." };
    const r0 = raw as unknown as Record<string, unknown>;
    const p = { ...toPartFull(r0), stock_item_id: (r0.stock_item_id as string | null) ?? null, refused_at: (r0.refused_at as string | null | undefined) ?? null, pending_handover_id: (r0.pending_handover_id as string | null) ?? null } as Part;
    const { data: job, error: jobErr } = await admin.from("jobs").select("id, job_number, is_open, department, vehicle:vehicles(vin)").eq("id", jobId).maybeSingle();
    if (jobErr) return fail("read the job", jobErr);
    if (!job) return { error: "Job not found." };
    const refusal = endingRefusal(p as EndingPart, input.ending);
    if (refusal) return { error: refusal };
    const cn = input.ending === "return" && input.creditNote ? { number: cleanText(input.creditNote.number, 60).toUpperCase() || null, path: input.creditNote.path || null, amount: input.creditNote.amount !== null && Number.isFinite(input.creditNote.amount) && input.creditNote.amount > 0 ? round2(input.creditNote.amount) : null, date: input.creditNote.date && /^\d{4}-\d{2}-\d{2}$/.test(input.creditNote.date) ? input.creditNote.date : null } : null;
    const state = stateOfChoice(input.ending, !!(cn?.number || cn?.path));
    const here = deliveredQty(p);
    const shelf = fromOurShelf(p);
    // Its LPO line (an inactive one is history, left alone) and the LPO.
    const { data: lineRaw, error: lineErr } = p.po_line_id ? await admin.from("purchase_order_lines").select("id, po_id, quantity, received_qty, unit_cost, invoice_unit_cost, is_active, part_number, description").eq("id", p.po_line_id).maybeSingle() : { data: null, error: null };
    if (lineErr) return fail("read the LPO line", lineErr);
    const line: Line | null = lineRaw && lineRaw.is_active ? { ...(lineRaw as unknown as Line), quantity: Number(lineRaw.quantity) || 0, received_qty: Number(lineRaw.received_qty) || 0, unit_cost: Number(lineRaw.unit_cost) || 0, invoice_unit_cost: lineRaw.invoice_unit_cost === null ? null : Number(lineRaw.invoice_unit_cost) } : null;
    const { data: poRaw, error: poErr } = line ? await admin.from("purchase_orders").select("id, number, kind, status, supplier_name, notes, total_cost_aed, received_at, job_id, supplier_invoice_status").eq("id", line.po_id).maybeSingle() : { data: null, error: null };
    if (poErr) return fail("read the LPO", poErr);
    const po: Po | null = poRaw && poRaw.status !== "cancelled" ? { ...(poRaw as unknown as Po), total_cost_aed: Number(poRaw.total_cost_aed) || 0 } : null;
    // What a kept or returned part is worth: the supplier's invoice price when entered, else the job's cost of it.
    const unitCost = line?.invoice_unit_cost ?? p.final_cost_aed ?? p.cost_aed ?? 0;
    // A part replaced by another supplier's part (Replace, 1 November 2026): the replacement keeps the quotation line.
    const { data: replacement, error: repErr } = p.replacement_part_id ? await admin.from("part_items").select("id, description").eq("id", p.replacement_part_id).eq("is_active", true).maybeSingle() : { data: null, error: null };
    if (repErr) return fail("read the replacement", repErr);
    // The job's documents that carry this part's cost (internal): a live proforma follows the ending (its cost goes to
    // 0, so the tax invoice it becomes copies 0); a tax invoice already out is never changed here - the owner is told.
    const { data: invRows, error: invErr } = await admin.from("invoice_lines").select("id, cost_aed, invoice:invoices!invoice_lines_invoice_id_fkey(id, number, kind, status, converted_to, is_active)").eq("part_item_id", p.id).eq("is_active", true);
    if (invErr) return fail("read the invoice lines", invErr);
    type InvLine = { id: string; cost_aed: number | string | null; invoice: { id: string; number: string; kind: string; status: string; converted_to: string | null; is_active: boolean | null } | null };
    const invLines = ((invRows ?? []) as unknown as InvLine[]).filter((l) => l.invoice && l.invoice.is_active !== false && l.invoice.status === "issued");
    const proformaLines = invLines.filter((l) => l.invoice!.kind === "proforma" && !l.invoice!.converted_to && Number(l.cost_aed) !== 0).map((l) => ({ id: l.id, cost: Number(l.cost_aed) || 0 }));
    const taxLines = invLines.filter((l) => l.invoice!.kind === "tax_invoice").map((l) => ({ number: l.invoice!.number, cost: Number(l.cost_aed) || 0 }));

    /* ---------- 2. The part, claimed (nobody else ended or changed it meanwhile) ---------- */
    const now = new Date().toISOString();
    const label = ENDING_LABEL[state];
    const patch: Record<string, unknown> = {
      disposition: storedDisposition(state, ready),
      disposition_at: now,
      disposition_by: actor.id,
      disposition_note: state === "returned" ? (cn?.number ?? null) : reason,
      not_needed_at: p.not_needed_at ?? now,
      not_needed_by: p.not_needed_by ?? actor.id,
      not_needed_reason: p.not_needed_reason ?? reason,
      // The cost is off the job: cancelled, back to the supplier (a credit note), or moved to stock.
      final_cost_aed: 0,
      is_active: false,
      removed_at: now,
      removed_by: actor.id,
      removed_reason: `${label}: ${reason}`,
      ready_for_handover_at: null,
      ready_for_handover_by: null,
      updated_by: actor.id,
      ...(state === "cancelled"
        ? { order_status: "none", expected_date: null, return_status: "none", returned_qty: 0 }
        : state === "stock"
          ? { order_status: "received", return_status: "none", returned_qty: 0 }
          : { order_status: "received", return_status: state === "returned" ? "returned" : "to_return", returned_qty: here, return_note: `${label}: ${reason}` }),
      ...(state === "returned" && cn?.path ? { credit_note_path: cn.path } : {}),
      ...(state === "returned" && ready ? { credit_note_number: cn?.number ?? null, credit_note_amount_aed: cn?.amount ?? null, credit_note_date: cn?.date ?? null, credit_note_at: now, credit_note_by: actor.id } : {}),
    };
    const pRec = p as unknown as Record<string, unknown>;
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(patch)) before[k] = k.startsWith("credit_note_") && k !== "credit_note_path" ? null : (pRec[k] ?? null);
    before.updated_by = actor.id;
    let claim = admin.from("part_items").update(patch).eq("id", p.id).eq("is_active", true).is("removed_at", null).eq("order_status", p.order_status ?? "none").eq("received_qty", here);
    claim = p.disposition ? claim.eq("disposition", p.disposition) : claim.is("disposition", null);
    claim = p.disposition_at ? claim.eq("disposition_at", p.disposition_at) : claim.is("disposition_at", null);
    const { data: claimed, error: claimErr } = await claim.select("id");
    if (claimErr) return fail("write the part", claimErr);
    if (!claimed?.length) return { error: "This part changed a moment ago (someone else ended or received it): nothing was saved. Look at it again." };
    const undoPart = async () => {
      const { error } = await admin.from("part_items").update(before).eq("id", p.id);
      if (error) await logAppError("end_part_undo", error, { staffId: actor.id, jobId, detail: { partId, step: "put the part back" } });
    };

    /* ---------- 3. Its LPO line: cancelled (nothing arrived), or cut to what arrived (the rest is cancelled) ---------- */
    const cutTo = line && state !== "cancelled" && line.quantity > Math.max(line.received_qty, here) + 0.005 ? Math.max(line.received_qty, here) : null;
    const linePatch = line ? (state === "cancelled" ? { is_active: false } : cutTo !== null && cutTo > 0 ? { quantity: cutTo } : null) : null;
    if (line && linePatch) {
      const { error } = await admin.from("purchase_order_lines").update({ ...linePatch, updated_by: actor.id }).eq("id", line.id);
      if (error) {
        await undoPart();
        return fail("write the LPO line", error);
      }
    }
    const undoLine = async () => {
      if (!line || !linePatch) return;
      const { error } = await admin.from("purchase_order_lines").update({ is_active: true, quantity: line.quantity, updated_by: actor.id }).eq("id", line.id);
      if (error) await logAppError("end_part_undo", error, { staffId: actor.id, jobId, detail: { partId, step: "put the LPO line back" } });
    };

    /* ---------- 4. The LPO: its total and status follow, the note says what happened ---------- */
    let poAfter: ReturnType<typeof poAfterEnding> | null = null;
    let movedCharges: string[] = [];
    const undoPo = async () => {
      if (!po) return;
      const { error } = await admin.from("purchase_orders").update({ total_cost_aed: po.total_cost_aed, status: po.status, notes: po.notes, supplier_name: po.supplier_name, received_at: po.received_at, supplier_invoice_status: po.supplier_invoice_status ?? "none", updated_by: actor.id }).eq("id", po.id);
      if (movedCharges.length) await admin.from("supplier_charges").update({ po_id: po.id, updated_by: actor.id }).in("id", movedCharges);
      if (error) await logAppError("end_part_undo", error, { staffId: actor.id, jobId, detail: { partId, step: "put the LPO back" } });
    };
    if (po && line) {
      const [{ data: rest, error: restErr }, { data: charges, error: chErr }] = await Promise.all([
        admin.from("purchase_order_lines").select("quantity, received_qty, unit_cost, part_item_id").eq("po_id", po.id).eq("is_active", true),
        admin.from("supplier_charges").select("id, supplier_name, amount_aed").eq("po_id", po.id).eq("is_active", true),
      ]);
      if (restErr || chErr) {
        await undoLine();
        await undoPart();
        return fail("read the LPO lines", restErr ?? chErr);
      }
      const restLines = (rest ?? []).map((l) => ({ quantity: Number(l.quantity) || 0, received_qty: Number(l.received_qty) || 0, unit_cost: Number(l.unit_cost) || 0, part: l.part_item_id as string | null }));
      // A main LPO still waiting: its supplier names follow, and a supplier with no line left takes its charges with it.
      let suppliers: string[] = [];
      if (po.kind === "main" && restLines.length) {
        const ids = restLines.map((l) => l.part).filter((x): x is string => !!x);
        const { data: sups, error: sErr } = ids.length ? await admin.from("part_items").select("supplier").in("id", ids) : { data: [], error: null };
        if (sErr) {
          await undoLine();
          await undoPart();
          return fail("read the LPO's suppliers", sErr);
        }
        suppliers = Array.from(new Set((sups ?? []).map((s) => String(s.supplier ?? "").trim()).filter(Boolean)));
        const mine = String(p.supplier ?? "").trim().toLowerCase();
        if (mine && po.status === "pending_approval" && !suppliers.some((s) => s.toLowerCase() === mine)) movedCharges = (charges ?? []).filter((c) => String(c.supplier_name ?? "").trim().toLowerCase() === mine).map((c) => c.id as string);
      }
      const chargesAed = round2((charges ?? []).filter((c) => !movedCharges.includes(c.id as string)).reduce((a, c) => a + (Number(c.amount_aed) || 0), 0));
      poAfter = poAfterEnding({ status: po.status, chargesAed }, restLines);
      const qtyWords = cutTo !== null ? ` (${line.quantity - cutTo} not delivered, cancelled with the supplier)` : "";
      const note = `${dubaiDay()} · ${String(p.description).toUpperCase()}: ${state === "cancelled" ? "cancelled with the supplier" : state === "stock" ? `kept in our stock${qtyWords}` : `returned to the supplier, credit note ${state === "returned" ? (cn?.number ?? "received") : "awaited"}${qtyWords}`} – ${actor.display_name}: ${reason}${poAfter.cancel ? ". No line left: this LPO is cancelled." : ""}`;
      const poPatch: Record<string, unknown> = { total_cost_aed: poAfter.total, notes: [po.notes, note].filter(Boolean).join("\n"), updated_by: actor.id };
      if (poAfter.status !== po.status) poPatch.status = poAfter.status;
      if (poAfter.status === "received" && po.status !== "received") poPatch.received_at = now;
      if (po.kind === "main" && suppliers.length) poPatch.supplier_name = suppliers.length === 1 ? suppliers[0] : `${suppliers.length} suppliers`;
      // Nothing left to deliver: no supplier invoice will come, so it no longer sits on the "invoice to follow" list.
      if (poAfter.cancel && po.supplier_invoice_status === "to_follow") poPatch.supplier_invoice_status = "none";
      if (movedCharges.length) {
        const { error } = await admin.from("supplier_charges").update({ po_id: null, updated_by: actor.id }).in("id", movedCharges);
        if (error) {
          movedCharges = [];
          await undoLine();
          await undoPart();
          return fail("take the supplier's charges off the LPO", error);
        }
      }
      const { error: upErr } = await admin.from("purchase_orders").update(poPatch).eq("id", po.id);
      if (upErr) {
        await undoPo();
        await undoLine();
        await undoPart();
        return fail("write the LPO", upErr);
      }
      // A never-ordered LPO with no line left: its charges leave with it (they stay on the job, without an LPO).
      if (poAfter.releaseCharges) {
        const { error } = await admin.from("supplier_charges").update({ po_id: null, updated_by: actor.id }).eq("po_id", po.id).eq("is_active", true);
        if (error) await logAppError("end_part", error, { staffId: actor.id, jobId, detail: { partId, step: "release the cancelled LPO's charges" } });
      }
    }

    /* ---------- 5. A proforma already made carries the part's cost on its line (internal only): it goes to 0 ---------- */
    const undoProforma = async () => {
      for (const l of proformaLines) {
        const { error } = await admin.from("invoice_lines").update({ cost_aed: l.cost, updated_by: actor.id }).eq("id", l.id);
        if (error) await logAppError("end_part_undo", error, { staffId: actor.id, jobId, detail: { partId, step: "put the proforma line's cost back" } });
      }
    };
    if (proformaLines.length) {
      const { error } = await admin.from("invoice_lines").update({ cost_aed: 0, updated_by: actor.id }).in("id", proformaLines.map((l) => l.id));
      if (error) {
        await undoPo();
        await undoLine();
        await undoPart();
        return fail("take the cost off the proforma", error);
      }
    }

    /* ---------- 6. Keep in stock: onto the shelf at what it cost (the stock item's average follows) ---------- */
    let stockWords = "";
    if (state === "stock") {
      const qty = here;
      const r = shelf && p.stock_item_id
        ? await recordStockMovement(p.stock_item_id, { kind: "return", quantity: qty, unitCost, jobId, partItemId: p.id, note: `Back on the shelf from ${job.job_number}: not needed (${reason})` }, actor)
        : await addPartToStock({ id: p.id, description: p.description, part_number: p.part_number, cost_aed: unitCost, quantity: qty, confirmed_quantity: qty, supplier: p.supplier }, actor, jobId);
      if (r.error) {
        await undoProforma();
        await undoPo();
        await undoLine();
        await undoPart();
        return fail("put the part on the shelf", r.error);
      }
      stockWords = ` ${qty % 1 === 0 ? qty : qty.toFixed(2)} on the shelf at ${aedText(unitCost)} each.`;
    }

    /* ---------- 7. After the ending: written down, the quotation, the plan, the people told (failures only logged) ---------- */
    const words = endingWords(state, actor.display_name);
    const after = async (step: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        await logAppError("end_part_after", e, { staffId: actor.id, jobId, detail: { partId, step } });
      }
    };
    const desc = String(p.description).toUpperCase();
    await after("job event", async () => {
      const { error } = await admin.from("job_events").insert({ job_id: jobId, event_type: "part_ended", note: `${desc}: ${label} (${actor.display_name}): ${reason}${po ? ` · ${po.number} now ${aedText(poAfter?.total ?? po.total_cost_aed)}${poAfter?.cancel ? ", cancelled" : ""}` : ""}${stockWords}`, created_by: actor.id });
      if (error) throw error;
    });
    if (state === "returned") await after("zoho vendor credit", () => tryEnqueueZoho("vendorcredit", p.id, jobId, actor.id));
    // A tax invoice already out keeps the part's cost (it is never changed from here): the owner corrects it.
    let taxWords = "";
    if (taxLines.length) {
      const nums = Array.from(new Set(taxLines.map((l) => l.number))).join(", ");
      const cost = round2(taxLines.reduce((a, l) => a + l.cost, 0));
      taxWords = ` Tax invoice ${nums} is already issued and still counts its cost (${aedText(cost)}): the owner is told to correct it.`;
      await after("owner: tax invoice cost", () => notifyRoles(["owner"], { type: "owner_approval_needed", title: `Cost correction needed · ${job.job_number}: ${desc} on ${nums}`, body: `${desc} – ${label} by ${actor.display_name} (${reason}). Tax invoice ${nums} still carries its cost, ${aedText(cost)}: the job's profit counts it until the cost is corrected (a credit note for the customer is separate).`, jobId, href: `/jobs/${jobId}/invoice` }));
    }
    const quote = { note: null as string | null };
    if (job.is_open) {
      await after("quotation", async () => {
        // A replacement from another supplier covers this part's quotation line: the line stays, it is the replacement's.
        if (replacement) {
          quote.note = `Its replacement (${String(replacement.description).toUpperCase()}) keeps its place on the quotation: the customer's price does not change.`;
          return;
        }
        const onQuote = await newestQuoteLineOf(jobId, p.id);
        if (!onQuote) return;
        const qv = await import("./quote-versions");
        if (onQuote.status === "draft" || onQuote.status === "pending_owner") {
          // Still being prepared: the line simply leaves it.
          await qv.syncPartLine(jobId, p.id, actor.id, onQuote.quotationId);
          quote.note = `It came off ${onQuote.number}, which is still being prepared.`;
          return;
        }
        // Sent or approved: the customer's price is never changed here, and the change lands on THIS quotation number
        // (never another quotation of the job). Sent: its next version, for the advisor to send. Approved: the owner is
        // asked to allow one revision. A tax invoice out: nothing can change; the owner settles it with a credit note.
        const out = await qv.revisePartOnQuotation(jobId, p.id, onQuote.quotationId, actor.id);
        if (out.kind !== "tax") await admin.from("quotations").update({ parts_price_changed_at: now, updated_by: actor.id }).eq("id", onQuote.quotationId);
        const onWords = `${desc} (${aedText(onQuote.lineTotal)} on ${onQuote.number})`;
        const advisors = await jobAdvisorIds(jobId);
        if (out.kind === "tax") {
          quote.note = `It is still on ${onQuote.number}, and tax invoice ${out.number} is already issued: the customer's price cannot change any more. The owner settles the difference with a credit note (he is told).`;
          await notifyStaff(advisors, { type: "parts_priced", title: `Part removed after the tax invoice · ${job.job_number}`, body: `${onWords} – ${label} by ${actor.display_name}: ${reason}. Tax invoice ${out.number} is already issued: the quotation cannot be revised. The owner settles the difference with a credit note.`, jobId, href: `/jobs/${jobId}/invoice` });
        } else if (onQuote.status === "approved" && out.kind === "asked") {
          quote.note = `It is still on ${onQuote.number} (approved, ${aedText(onQuote.lineTotal)} before VAT): the customer's approved price has not changed. The owner is asked to allow the revision; the advisor is told to revise it.`;
          await notifyStaff(advisors, { type: "parts_priced", title: `Part removed after approval · ${job.job_number}: revise the quotation`, body: `${onWords} – ${label} by ${actor.display_name}: ${reason}. The customer's approved price has not changed: revise ${onQuote.number} (the owner is asked to allow the revision) and send it to the customer.`, jobId, href: `/jobs/${jobId}/quote/${onQuote.quotationId}` });
        } else if (out.kind === "target") {
          // A new version without the part (the advisor was told to send it), or the version still being prepared.
          quote.note = onQuote.status === "approved"
            ? `It was on ${onQuote.number} (approved): the owner had already allowed a revision, so ${out.version ? `version ${out.version}` : "the new version"} without it is ready for the advisor to send. The customer's price changes only when they approve it.`
            : `It was on ${onQuote.number}, sent to the customer: ${out.version ? `version ${out.version}` : "a new version"} without it is ready for the advisor to send.`;
        } else {
          quote.note = `It is still on ${onQuote.number}: the advisor is told to look at the quotation.`;
          await notifyStaff(advisors, { type: "parts_priced", title: `Part removed · ${job.job_number}: check the quotation`, body: `${onWords} – ${label} by ${actor.display_name}: ${reason}. It is still on ${onQuote.number}.`, jobId, href: `/jobs/${jobId}/quote/${onQuote.quotationId}` });
        }
      });
      if (state === "cancelled") await after("plan", () => finishPartsPlanning(jobId, actor, { quiet: true }));
      await after("notices", async () => {
        // Workshop managers cannot open the Parts page: their bell opens the car's work order.
        const n = { type: "parts_priced", title: `Part removed · ${job.job_number}`, body: `${desc}: ${label} by ${actor.display_name} (${reason}).${po ? ` ${po.number} is now ${aedText(poAfter?.total ?? po.total_cost_aed)}${poAfter?.cancel ? " (cancelled)" : ""}.` : ""}`, jobId, href: `/jobs/${jobId}/work` };
        await notifyManagers((job as { department: string | null }).department ?? null, n);
      });
    }
    const vin = ((job.vehicle as unknown as { vin: string | null } | null)?.vin) ?? null;
    // Only part of the line came: whatever its ending, the rest is cancelled with the supplier and the supplier is told.
    const missing = line && cutTo !== null ? notDeliveredQty(line.quantity, cutTo) : 0;
    const ordered = !!po && ["ordered", "partly_received", "received"].includes(po.status);
    const tellSupplier = !!po && !shelf && (state === "return_pending" || state === "returned" || (state === "cancelled" && ordered) || (missing > 0 && ordered));
    const partNumber = realPartNumber(line?.part_number ?? p.part_number);
    const supplierCopy = tellSupplier && po
      ? { supplier: po.supplier_name, text: supplierMessage(state, { lpo: po.number, vin, lines: state === "stock" ? [] : [{ name: p.description, partNumber, qty: state === "cancelled" ? line?.quantity ?? here : here }], notDelivered: missing > 0 ? [{ name: p.description, partNumber, qty: missing }] : [] }) }
      : null;
    const lpoWords = po && poAfter ? (poAfter.cancel ? ` ${po.number} has no line left: cancelled.` : ` ${po.number} total now ${aedText(poAfter.total)}.`) : "";
    const costWords = taxWords || (proformaLines.length ? " Its cost is off the job (and off the proforma)." : " Its cost is off the job.");
    const message = `${desc}: ${label}.${lpoWords}${poAfter?.chargeNote ? ` ${poAfter.chargeNote}` : ""}${stockWords}${costWords}${state === "return_pending" ? " The credit note is awaited: Returns and leftovers lists it until it is recorded." : ""}${quote.note ? ` ${quote.note}` : ""}`;
    return { ok: true, state, words, message, supplierCopy, quoteNote: quote.note };
  } catch (e) {
    return fail("unexpected", e);
  }
}

/**
 * The supplier's credit note for a part returned to them (number and/or scan, the amount and date when known): the
 * return is complete, and it becomes a supplier credit (vendor credit) in Zoho.
 */
export async function recordCreditNote(jobId: string, partId: string, input: CreditNoteInput, actor: EndActor): Promise<EndResult> {
  const admin = createAdminClient();
  const number = cleanText(input.number, 60).toUpperCase() || null;
  const path = input.path || null;
  if (!number && !path) return { error: "Type the credit note number, or attach its scan." };
  const amount = input.amount !== null && Number.isFinite(input.amount) && input.amount > 0 ? round2(input.amount) : null;
  const date = input.date && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
  try {
    const ready = await partEndingsReady();
    const { data: raw, error } = await admin.from("part_items").select("id, job_id, description, disposition, disposition_at, return_status, credit_note_path").eq("id", partId).eq("job_id", jobId).maybeSingle();
    if (error) {
      await logAppError("credit_note", error, { staffId: actor.id, jobId, detail: { partId, step: "read the part" } });
      return { error: SAVE_FAILED };
    }
    if (!raw) return { error: "This part is not on this job any more." };
    if (endingOf(raw) !== "return_pending") return { error: endingOf(raw) === "returned" ? "Its credit note is already recorded." : "This part is not waiting for a credit note." };
    const now = new Date().toISOString();
    let q = admin
      .from("part_items")
      .update({ disposition: "returned", disposition_note: number, return_status: "returned", credit_note_path: path ?? raw.credit_note_path, ...(ready ? { credit_note_number: number, credit_note_amount_aed: amount, credit_note_date: date, credit_note_at: now, credit_note_by: actor.id } : {}), updated_by: actor.id })
      .eq("id", partId)
      .eq("return_status", "to_return");
    q = raw.disposition ? q.eq("disposition", raw.disposition) : q.is("disposition", null);
    const { data: done, error: upErr } = await q.select("id");
    if (upErr) {
      await logAppError("credit_note", upErr, { staffId: actor.id, jobId, detail: { partId, step: "write the credit note" } });
      return { error: SAVE_FAILED };
    }
    if (!done?.length) return { error: "Its credit note was recorded a moment ago by someone else." };
    const desc = String(raw.description).toUpperCase();
    const { error: evErr } = await admin.from("job_events").insert({ job_id: jobId, event_type: "part_credit_note", note: `${desc}: supplier credit note ${number ?? "(scan)"}${amount ? `, ${aedText(amount)}` : ""} recorded by ${actor.display_name}`, created_by: actor.id });
    if (evErr) await logAppError("credit_note", evErr, { staffId: actor.id, jobId, detail: { partId, step: "job event" } });
    // Zoho Books: the return becomes a supplier credit against the supplier's bill.
    await tryEnqueueZoho("vendorcredit", partId, jobId, actor.id);
    return { ok: true, state: "returned", words: endingWords("returned", actor.display_name), message: `${desc}: credit note ${number ?? "scan"} recorded. The return is complete.` };
  } catch (e) {
    await logAppError("credit_note", e, { staffId: actor.id, jobId, detail: { partId, step: "unexpected" } });
    return { error: SAVE_FAILED };
  }
}

export type AwaitedCreditNote = {
  id: string;
  jobId: string;
  jobNumber: string;
  jobOpen: boolean;
  car: { kind?: string | null; has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null;
  description: string;
  qty: number;
  value: number;
  supplier: string | null;
  lpo: string | null;
  lpoId: string | null;
  since: string;
  by: string | null;
  reason: string | null;
};

/** Every part returned to a supplier and still waiting for its credit note, oldest first (the tracking list). */
export async function creditNotesAwaited(): Promise<AwaitedCreditNote[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("part_items")
    .select("id, job_id, description, supplier, received_qty, returned_qty, quantity, confirmed_quantity, cost_aed, final_cost_aed, po_id, po_line_id, disposition, disposition_at, disposition_by, return_status, not_needed_reason, job:jobs(id, job_number, is_open, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name)))")
    .or("disposition.eq.return_pending,and(disposition.is.null,disposition_at.not.is.null,return_status.eq.to_return)")
    .order("disposition_at");
  if (error) {
    await logAppError("credit_notes_awaited", error);
    return [];
  }
  const rows = ((data ?? []) as unknown as (Record<string, unknown> & { job: { id: string; job_number: string; is_open: boolean; vehicle: AwaitedCreditNote["car"] } | null })[]).filter((r) => endingOf(r as EndingPart) === "return_pending");
  const poIds = Array.from(new Set(rows.map((r) => r.po_id as string | null).filter((x): x is string => !!x)));
  const people = Array.from(new Set(rows.map((r) => r.disposition_by as string | null).filter((x): x is string => !!x)));
  const lineIds = Array.from(new Set(rows.map((r) => r.po_line_id as string | null).filter((x): x is string => !!x)));
  const [{ data: pos }, { data: staff }, { data: lineRows }] = await Promise.all([
    poIds.length ? admin.from("purchase_orders").select("id, number, supplier_name").in("id", poIds) : Promise.resolve({ data: [] as { id: string; number: string; supplier_name: string }[] }),
    people.length ? admin.from("staff").select("id, display_name").in("id", people) : Promise.resolve({ data: [] as { id: string; display_name: string }[] }),
    lineIds.length ? admin.from("purchase_order_lines").select("id, unit_cost, invoice_unit_cost").in("id", lineIds) : Promise.resolve({ data: [] as { id: string; unit_cost: number | string | null; invoice_unit_cost: number | string | null }[] }),
  ]);
  const poOf = new Map((pos ?? []).map((o) => [o.id as string, o]));
  const nameOf = new Map((staff ?? []).map((s) => [s.id as string, s.display_name as string]));
  const lineOf = new Map((lineRows ?? []).map((l) => [l.id as string, l]));
  const numOrNull = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  return rows.map((r) => {
    const qty = Number(r.returned_qty) || Number(r.received_qty) || Number(r.confirmed_quantity ?? r.quantity) || 1;
    const po = r.po_id ? poOf.get(r.po_id as string) : undefined;
    const l = r.po_line_id ? lineOf.get(r.po_line_id as string) : undefined;
    // What the supplier billed for it (THE return-credit rule, the same figure the Zoho supplier credit posts).
    const credit = returnCreditOf({ qty, invoiceUnit: numOrNull(l?.invoice_unit_cost), lineUnit: numOrNull(l?.unit_cost), finalCost: numOrNull(r.final_cost_aed), cost: numOrNull(r.cost_aed) });
    return {
      id: String(r.id),
      jobId: String(r.job_id),
      jobNumber: r.job?.job_number ?? "",
      jobOpen: !!r.job?.is_open,
      car: r.job?.vehicle ?? null,
      description: String(r.description ?? ""),
      qty,
      value: credit.amount,
      supplier: (po?.supplier_name as string | undefined) ?? ((r.supplier as string | null) ?? null),
      lpo: (po?.number as string | undefined) ?? null,
      lpoId: (po?.id as string | undefined) ?? null,
      since: String(r.disposition_at ?? ""),
      by: nameOf.get(String(r.disposition_by ?? "")) ?? null,
      reason: (r.not_needed_reason as string | null) ?? null,
    };
  });
}

export type EndedLine = { lineId: string; poId: string; partId: string; description: string; partNumber: string | null; quantity: number; unitCost: number; state: EndingState; words: string; /** The line is still on the LPO (delivered: returned or kept); a cancelled one is off it. */ onLpo: boolean };

/**
 * The LPO lines whose part was given an ending, per LPO, for the cards and the LPO page: cancelled lines (off the LPO,
 * shown greyed) and returned or kept ones (still on it: delivered and invoiced, with the return awaiting its credit).
 */
export async function endedLinesOf(poIds: string[]): Promise<Map<string, EndedLine[]>> {
  const out = new Map<string, EndedLine[]>();
  const ids = Array.from(new Set(poIds.filter(Boolean)));
  if (!ids.length) return out;
  const admin = createAdminClient();
  const { data: parts, error } = await admin.from("part_items").select("id, po_id, po_line_id, description, disposition, disposition_at, disposition_by, return_status").in("po_id", ids).not("disposition_at", "is", null);
  if (error) {
    await logAppError("ended_lines", error);
    return out;
  }
  const ended = (parts ?? []).filter((p) => !!endingOf(p as EndingPart) && p.po_line_id);
  if (!ended.length) return out;
  const [{ data: lines }, { data: staff }] = await Promise.all([
    admin.from("purchase_order_lines").select("id, po_id, description, part_number, quantity, unit_cost, is_active").in("id", ended.map((p) => p.po_line_id as string)),
    admin.from("staff").select("id, display_name").in("id", Array.from(new Set(ended.map((p) => p.disposition_by as string).filter(Boolean)))),
  ]);
  const lineOf = new Map((lines ?? []).map((l) => [l.id as string, l]));
  const nameOf = new Map((staff ?? []).map((s) => [s.id as string, s.display_name as string]));
  for (const p of ended) {
    const l = lineOf.get(p.po_line_id as string);
    if (!l) continue;
    const state = endingOf(p as EndingPart) as EndingState;
    const row: EndedLine = { lineId: String(l.id), poId: String(l.po_id), partId: String(p.id), description: String(l.description ?? p.description), partNumber: realPartNumber((l.part_number as string | null) ?? null), quantity: Number(l.quantity) || 0, unitCost: Number(l.unit_cost) || 0, state, words: `${LINE_ENDING_LABEL[state]} · ${nameOf.get(String(p.disposition_by ?? "")) ?? "Parts"}`, onLpo: !!l.is_active };
    out.set(row.poId, [...(out.get(row.poId) ?? []), row]);
  }
  return out;
}

/** The job's supplier LPOs cancelled because every line ended (the cards keep showing them, greyed). */
export async function cancelledSupplierLpos(jobId: string): Promise<{ id: string; number: string; supplier_name: string; status: string; ordered_at: string | null; verify_token: string | null; total_cost_aed: number }[]> {
  const { data, error } = await createAdminClient().from("purchase_orders").select("id, number, supplier_name, status, ordered_at, verify_token, total_cost_aed").eq("job_id", jobId).eq("kind", "supplier").eq("status", "cancelled").eq("is_active", true).order("created_at");
  if (error) {
    await logAppError("cancelled_lpos", error, { jobId });
    return [];
  }
  return (data ?? []).map((o) => ({ ...(o as { id: string; number: string; supplier_name: string; status: string; ordered_at: string | null; verify_token: string | null }), total_cost_aed: Number(o.total_cost_aed) || 0 }));
}

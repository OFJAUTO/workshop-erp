import "server-only";
import { createAdminClient } from "./supabase/admin";
import { logAppError, SAVE_FAILED } from "./app-errors";
import { getSettings } from "./settings";
import { openPurchaseReturn, purchaseReturnsReady } from "./purchase-returns";
import { recordCreditNote } from "./part-endings-server";
import { requestPartChange } from "./part-change";
import { supplierChargesVat } from "./supplier-rules";
import { round2 } from "./money";
import { creditTotals, lpoNetOf, reasonLabel, replacesWords, returnRulesOf, returnWindowOf, type ReturnReasonKey } from "./supplier-return-rules";

/*
 * PURCHASE RETURNS AND SUPPLIER CREDIT NOTES (19 November 2026, Section 4). The parts desk starts a return from the
 * LPO ("Return to supplier": the received parts going back, how many, why, and one replacement line on the SAME LPO
 * covering them); accounts enter the supplier's credit note (one number, several parts, the scan); the LPO shows
 * invoiced, credited, re-invoiced and the net. The returned parts leave the job's cost (an ending, credit awaited);
 * the replacement enters it, and a replacement dearer than what went back goes through the "cost went up" approval.
 * Zoho gets the supplier credit per part, applied to the original bill, with the credit note number.
 */

type Actor = { id: string; display_name: string; role_id: string };
const today = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);
const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const RULES_KEY = "supplier_return_rules";

/** Part columns copied to a partial return's twin and to a replacement (only those present on the row). */
const COPY = ["job_id", "part_request_id", "description", "part_number", "supplier", "part_type", "brand", "positions", "unit", "cost_aed", "list_price_aed", "discount_percent", "availability", "delivery_date", "priced_at", "priced_by", "po_id", "catalogue_id", "client_key"];
const pick = (o: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => k in o && k !== "client_key").map((k) => [k, o[k]]));

export type ReturnablePart = { id: string; name: string; quantity: number; received: number; unitCost: number; withTech: boolean; window: ReturnType<typeof returnWindowOf> };

/** The received parts of a supplier LPO that can go back, with the supplier's window words. */
export async function returnableParts(poId: string): Promise<ReturnablePart[]> {
  const admin = createAdminClient();
  const [{ data: po }, { data: parts }, settings] = await Promise.all([
    admin.from("purchase_orders").select("id, supplier_id, kind").eq("id", poId).maybeSingle(),
    admin.from("part_items").select("id, description, quantity, confirmed_quantity, received_qty, cost_aed, final_cost_aed, issue_status, is_active, disposition, po_line_id, updated_at").eq("po_id", poId).eq("is_active", true),
    getSettings(),
  ]);
  if (!po || po.kind === "main") return [];
  const rules = returnRulesOf((settings as unknown as Record<string, unknown>)[RULES_KEY], po.supplier_id as string | null);
  const { data: lines } = await admin.from("purchase_order_lines").select("id, unit_cost, invoice_unit_cost, received_at").eq("po_id", poId);
  const lineOf = new Map(((lines ?? []) as { id: string; unit_cost: number | string; invoice_unit_cost: number | string | null; received_at?: string | null }[]).map((l) => [l.id, l]));
  return ((parts ?? []) as Record<string, unknown>[])
    .filter((p) => Number(p.received_qty) > 0 && !p.disposition)
    .map((p) => {
      const l = lineOf.get(String(p.po_line_id ?? ""));
      const unit = Number(l?.invoice_unit_cost ?? l?.unit_cost ?? p.final_cost_aed ?? p.cost_aed) || 0;
      const receivedDay = (l?.received_at as string | undefined)?.slice(0, 10) ?? String(p.updated_at ?? "").slice(0, 10) ?? null;
      return { id: String(p.id), name: String(p.description), quantity: Number(p.confirmed_quantity ?? p.quantity) || 0, received: Number(p.received_qty) || 0, unitCost: round2(unit), withTech: p.issue_status === "confirmed", window: returnWindowOf(rules, { name: String(p.description), receivedDay }, today()) };
    });
}

export type ReturnInput = { items: { partId: string; qty: number }[]; reason: ReturnReasonKey; note: string; replacement: { name: string; price: number | null } | null };

/**
 * "Return to supplier" (the parts desk or the owner). Each ticked part (or the pieces of it) goes back: it leaves the
 * job's cost, waits for the supplier's credit (a purchase return opens, accounts are told on sending). With a
 * replacement, ONE new line on the same LPO covers them ("replaces returned …").
 */
export async function startReturns(poId: string, input: ReturnInput, by: Actor): Promise<{ error?: string; words?: string }> {
  if (!["owner", "parts"].includes(by.role_id)) return { error: "Only the parts desk or the owner send parts back." };
  if (!(await purchaseReturnsReady())) return { error: "Purchase returns are waiting for the database update." };
  if (!input.items.length) return { error: "Tick the parts going back." };
  if (!input.reason) return { error: "Pick why they go back." };
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("id, number, job_id, supplier_id, supplier_name, kind").eq("id", poId).maybeSingle();
  if (!po || po.kind === "main") return { error: "Returns start from the supplier's own LPO." };
  const can = new Map((await returnableParts(poId)).map((p) => [p.id, p]));
  for (const it of input.items) {
    const p = can.get(it.partId);
    if (!p) return { error: "One ticked part is not received on this LPO any more: reload the page." };
    if (p.withTech) return { error: `${p.name.toUpperCase()} is with the technician: he hands it back first (Parts → Returns and leftovers), then it can go to the supplier.` };
    if (p.window.blocked && by.role_id !== "owner") return { error: `${p.name.toUpperCase()}: ${p.window.words} Ask the owner.` };
    if (!(it.qty > 0) || it.qty > p.received + 0.0001) return { error: `${p.name.toUpperCase()}: at most ${p.received} can go back.` };
  }
  const reasonText = `${reasonLabel(input.reason)}${input.note.trim() ? `: ${input.note.trim().slice(0, 200)}` : ""}`;
  const now = new Date().toISOString();
  const returned: { id: string; name: string; cost: number; jobId: string | null; prNumber: string | null }[] = [];
  for (const it of input.items) {
    const p = can.get(it.partId)!;
    const { data: raw } = await admin.from("part_items").select("*").eq("id", it.partId).maybeSingle();
    if (!raw) return { error: SAVE_FAILED };
    const row = raw as Record<string, unknown>;
    let target = it.partId;
    const ending = { disposition: "return_pending", disposition_at: now, disposition_by: by.id, disposition_note: reasonText, return_status: "to_return", returned_qty: it.qty, removed_at: now, removed_by: by.id, removed_reason: `Returned to ${po.supplier_name}: ${reasonText}`, final_cost_aed: 0, is_active: false, updated_by: by.id };
    if (it.qty < p.received - 0.0001) {
      // Some pieces go back: the part keeps the rest; a twin carries the pieces going back.
      const left = round2(p.received - it.qty);
      const { error: e1 } = await admin.from("part_items").update({ quantity: left, confirmed_quantity: left, received_qty: left, updated_by: by.id }).eq("id", it.partId);
      if (e1) { await logAppError("supplier-returns: split", e1, { staffId: by.id }); return { error: SAVE_FAILED }; }
      const { data: twin, error: e2 } = await admin.from("part_items").insert({ ...pick(row, COPY), quantity: it.qty, confirmed_quantity: it.qty, received_qty: it.qty, order_status: row.order_status, po_line_id: row.po_line_id, created_by: by.id, ...ending }).select("id").single();
      if (e2 || !twin) { await logAppError("supplier-returns: twin", e2 ?? new Error("no row"), { staffId: by.id }); return { error: SAVE_FAILED }; }
      target = String(twin.id);
    } else {
      const { error: e3 } = await admin.from("part_items").update(ending).eq("id", it.partId).is("disposition", null);
      if (e3) { await logAppError("supplier-returns: end", e3, { staffId: by.id }); return { error: SAVE_FAILED }; }
    }
    const pr = await openPurchaseReturn(target, reasonText, { id: by.id, display_name: by.display_name }, { quantity: it.qty });
    returned.push({ id: target, name: p.name, cost: round2(p.unitCost * it.qty), jobId: (row.job_id as string | null) ?? null, prNumber: pr });
  }
  const back = round2(returned.reduce((a, r) => a + r.cost, 0));
  let replacementWords = "";
  if (input.replacement) {
    // ONE replacement line on the SAME LPO, at the returned cost until its own invoice says otherwise.
    const first = returned[0];
    const name = (input.replacement.name.trim() || first.name).toUpperCase();
    const { data: src } = await admin.from("part_items").select("*").eq("id", input.items[0].partId).maybeSingle();
    const { data: pos } = await admin.from("purchase_order_lines").select("position").eq("po_id", poId).order("position", { ascending: false }).limit(1);
    const position = (Number((pos ?? [])[0]?.position) || 0) + 1;
    const { data: rep, error: e4 } = await admin.from("part_items").insert({ ...pick((src ?? {}) as Record<string, unknown>, COPY), description: name, quantity: 1, confirmed_quantity: 1, received_qty: 0, cost_aed: back, order_status: "ordered", replaced_part_id: first.id, is_active: true, created_by: by.id, updated_by: by.id }).select("id").single();
    if (e4 || !rep) { await logAppError("supplier-returns: replacement", e4 ?? new Error("no row"), { staffId: by.id }); return { error: `The parts are going back, but the replacement line could not be added (${SAVE_FAILED})` }; }
    const words = replacesWords(returned.map((r) => r.name));
    const { data: line, error: e5 } = await admin.from("purchase_order_lines").insert({ po_id: poId, part_item_id: rep.id, position, description: `${name} – ${words}`, quantity: 1, unit_cost: back }).select("id").single();
    if (e5 || !line) { await logAppError("supplier-returns: replacement line", e5 ?? new Error("no row"), { staffId: by.id }); return { error: SAVE_FAILED }; }
    await admin.from("part_items").update({ po_line_id: line.id }).eq("id", rep.id);
    await admin.from("part_items").update({ replacement_part_id: rep.id }).in("id", returned.map((r) => r.id));
    replacementWords = ` A replacement line was added to ${po.number}: ${name} – ${words}, at ${aed(back)} until its invoice.`;
    const price = input.replacement.price;
    if (price !== null && price > 0 && Math.abs(price - back) > 0.004) {
      if (price > back && po.job_id) {
        // Dearer than what went back: THE "cost went up" approval (17 November 2026, Section 4).
        const r = await requestPartChange(po.job_id, String(rep.id), { supplier: String(po.supplier_name), cost: price, days: null, inStock: false, partNumber: null, partType: null, reason: `Replacement costs more than the returned parts (${aed(back)} went back, the replacement is ${aed(price)}, +${aed(round2(price - back)).replace("AED ", "")})`, choice: "keep" }, by);
        replacementWords += r.error ? ` The replacement price ${aed(price)} could not go for approval: ${r.error}` : ` It costs ${aed(price)} (+${aed(round2(price - back)).replace("AED ", "")}): ${r.words ?? "sent for approval"}.`;
      } else {
        await admin.from("part_items").update({ cost_aed: price, updated_by: by.id }).eq("id", rep.id);
        await admin.from("purchase_order_lines").update({ unit_cost: price }).eq("id", line.id);
        replacementWords += ` Its price is ${aed(price)}.`;
      }
    }
  }
  const jobId = po.job_id as string | null;
  if (jobId) await admin.from("job_events").insert({ job_id: jobId, event_type: "purchase_return", note: `Going back to ${po.supplier_name} from ${po.number} (${reasonText}): ${returned.map((r) => `${r.name.toUpperCase()}${r.prNumber ? ` (${r.prNumber})` : ""}`).join(", ")} – ${aed(back)} leaves the job's cost.${replacementWords} (${by.display_name})`, created_by: by.id });
  return { words: `${returned.length} part${returned.length === 1 ? "" : "s"} going back to ${po.supplier_name} (${aed(back)}, credit awaited): ${returned.map((r) => r.prNumber ?? r.name).join(", ")}.${replacementWords}` };
}

export type CreditNoteInput = { poId: string; number: string; date: string; lines: { partId: string; amount: number }[]; vat: number | null; scanPath: string | null };

/**
 * The supplier's credit note (accounts and the owner): one number, the parts and their amounts before VAT, the VAT
 * (5% unless typed), the scan, the invoice it refers to (the LPO's). A part never started as a return becomes one now.
 */
export async function enterCreditNote(input: CreditNoteInput, by: Actor): Promise<{ error?: string; words?: string }> {
  if (!["owner", "accounts"].includes(by.role_id)) return { error: "Only accounts or the owner enter a supplier's credit note." };
  if (!(await purchaseReturnsReady())) return { error: "Purchase returns are waiting for the database update." };
  const number = input.number.trim().toUpperCase().slice(0, 60);
  if (number.length < 2) return { error: "Type the supplier's credit note number." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date > today()) return { error: "Pick the credit note's date (not in the future)." };
  const lines = input.lines.filter((l) => l.amount > 0);
  if (!lines.length) return { error: "Tick the parts on the credit note and type their amounts before VAT." };
  const admin = createAdminClient();
  const { data: po } = await admin.from("purchase_orders").select("id, number, job_id, supplier_id, supplier_name, supplier_invoice_number").eq("id", input.poId).maybeSingle();
  if (!po) return { error: "That LPO is not there any more." };
  const { data: sup } = po.supplier_id ? await admin.from("suppliers").select("name, trn, vat_registered").eq("id", po.supplier_id).maybeSingle() : { data: null };
  const chargesVat = supplierChargesVat({ name: String(po.supplier_name), vat_registered: (sup as { vat_registered?: boolean } | null)?.vat_registered !== false, trn: (sup as { trn?: string | null } | null)?.trn ?? null });
  const net = round2(lines.reduce((a, l) => a + l.amount, 0));
  const tot = creditTotals(net, input.vat, chargesVat);
  // A part on the note that never started as a return: it goes back now (no replacement), credit arriving with it.
  const notStarted: string[] = [];
  for (const l of lines) {
    const { data: p } = await admin.from("part_items").select("id, description, disposition, received_qty, quantity").eq("id", l.partId).maybeSingle();
    if (!p) return { error: "One part on the credit note is not on this LPO any more: reload the page." };
    if (!p.disposition) {
      const r = await startReturns(input.poId, { items: [{ partId: l.partId, qty: Number(p.received_qty) || Number(p.quantity) || 1 }], reason: "not_needed", note: `Credit note ${number}`, replacement: null }, { ...by, role_id: "owner" });
      if (r.error) return { error: r.error };
      notStarted.push(String(p.description).toUpperCase());
    }
  }
  let vatLeft = tot.vat;
  const done: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const vatShare = i === lines.length - 1 ? round2(vatLeft) : round2((l.amount / net) * tot.vat);
    vatLeft = round2(vatLeft - vatShare);
    // The ending → "returned" with THE credit note (the Zoho supplier credit is queued per part, applied to the bill).
    const { data: part } = await admin.from("part_items").select("id, job_id, description").eq("id", l.partId).maybeSingle();
    const jobId = String(part?.job_id ?? po.job_id ?? "");
    if (jobId) {
      const r = await recordCreditNote(jobId, l.partId, { number, path: input.scanPath, amount: round2(l.amount), date: input.date }, { id: by.id, display_name: by.display_name, role_id: by.role_id });
      if (r.error && !/already recorded/i.test(r.error)) return { error: `${String(part?.description ?? "").toUpperCase()}: ${r.error}` };
    }
    const { data: pr } = await admin.from("purchase_returns").select("id").eq("part_item_id", l.partId).eq("is_active", true).in("status", ["requested", "sent"]).limit(1).maybeSingle();
    if (pr) {
      const { error } = await admin.from("purchase_returns").update({ status: "credited", credit_number: number, credit_date: input.date, credit_net_aed: round2(l.amount), credit_vat_aed: vatShare, credit_scan_path: input.scanPath, closed_at: new Date().toISOString(), closed_by: by.id, updated_by: by.id }).eq("id", pr.id).in("status", ["requested", "sent"]);
      if (error) { await logAppError("supplier-returns: credit", error, { staffId: by.id }); return { error: SAVE_FAILED }; }
    }
    done.push(String(part?.description ?? "").toUpperCase());
  }
  if (po.job_id) await admin.from("job_events").insert({ job_id: po.job_id, event_type: "purchase_return", note: `Supplier credit note ${number} (${input.date}) from ${po.supplier_name} against ${po.supplier_invoice_number ?? po.number}: ${done.join(" + ")} – ${aed(tot.net)} + VAT ${aed(tot.vat).replace("AED ", "")} = ${aed(tot.total)} (${by.display_name})`, created_by: by.id });
  return { words: `Credit note ${number} saved: ${aed(tot.net)} + VAT ${aed(tot.vat).replace("AED ", "")} = ${aed(tot.total)} off what we owe ${po.supplier_name}${notStarted.length ? ` (${notStarted.join(", ")} marked as returned now)` : ""}. Zoho gets the supplier credit against the bill ${po.supplier_invoice_number ?? po.number}.` };
}

/** The LPO after returns: invoiced (its invoices), credited (the credit notes), re-invoiced (replacement invoices), net. */
export async function lpoReturnSummary(poId: string): Promise<{ invoiced: number; credited: number; reinvoiced: number; net: number; creditNotes: string[] } | null> {
  if (!(await purchaseReturnsReady())) return null;
  const admin = createAdminClient();
  const vatCol = ", supplier_invoice_vat_aed";
  const { data: po } = await admin.from("purchase_orders").select("id, supplier_invoice_status, supplier_invoice_amount, supplier_id, supplier_name" + vatCol).eq("id", poId).maybeSingle();
  const p = po as unknown as { supplier_invoice_status: string; supplier_invoice_amount: number | string | null; supplier_invoice_vat_aed: number | string | null; supplier_id: string | null; supplier_name: string } | null;
  if (!p) return null;
  const { data: credits } = await admin.from("purchase_returns").select("credit_number, credit_net_aed, credit_vat_aed").eq("po_id", poId).eq("is_active", true).eq("status", "credited");
  const cr = (credits ?? []) as { credit_number: string | null; credit_net_aed: number | string | null; credit_vat_aed: number | string | null }[];
  if (!cr.length) return null;
  const firstNet = Number(p.supplier_invoice_amount) || 0;
  const firstVat = p.supplier_invoice_vat_aed != null ? Number(p.supplier_invoice_vat_aed) : round2(firstNet * 0.05);
  const { lpoInvoicesReady, loadLpoInvoices } = await import("./lpo-invoices");
  let re = 0;
  if (await lpoInvoicesReady()) {
    const more = (await loadLpoInvoices([poId])).get(poId) ?? [];
    re = round2(more.filter((i) => (i as unknown as { status?: string }).status !== "void").reduce((a, i) => a + (Number(i.amount_aed) || 0) + (Number(i.vat_aed) || 0), 0));
  }
  const credited = round2(cr.reduce((a, c) => a + (Number(c.credit_net_aed) || 0) + (Number(c.credit_vat_aed) || 0), 0));
  const n = lpoNetOf({ invoiced: round2(firstNet + firstVat), credited, reinvoiced: re });
  return { ...n, creditNotes: Array.from(new Set(cr.map((c) => c.credit_number).filter((x): x is string => !!x))) };
}

/** The supplier return windows (Settings, per supplier): owner, accounts and the parts desk keep them. */
export async function saveReturnRules(supplierId: string, rules: { returnDays: number | null; creditDays: number | null; noElectrical: boolean }, by: Actor): Promise<{ error?: string }> {
  if (!["owner", "accounts", "parts"].includes(by.role_id)) return { error: "Only the parts desk, accounts or the owner set a supplier's return window." };
  const admin = createAdminClient();
  const { data } = await admin.from("settings").select("value").eq("key", RULES_KEY).maybeSingle();
  const all = { ...((data?.value as Record<string, unknown> | null) ?? {}), [supplierId]: rules };
  const { error } = await admin.from("settings").upsert({ key: RULES_KEY, value: all, label: "Supplier return windows", updated_by: by.id }, { onConflict: "key" });
  if (error) { await logAppError("supplier-returns: rules", error, { staffId: by.id }); return { error: SAVE_FAILED }; }
  return {};
}

/**
 * The invoices a credit note can refer to (the "+ Enter a credit note" window): supplier LPOs with their invoice
 * entered, newest first, each with its parts that are received or waiting for a credit (not credited yet).
 */
export async function creditNoteOptions(opts: { poIds?: string[] } = {}): Promise<{ poId: string; jobId: string | null; label: string; chargesVat: boolean; parts: { id: string; name: string; qty: number; unit: number; state: string }[] }[]> {
  const admin = createAdminClient();
  let q = admin.from("purchase_orders").select("id, number, job_id, supplier_id, supplier_name, supplier_invoice_number, supplier_invoice_date, kind").in("kind", ["supplier", "stock"]).eq("supplier_invoice_status", "received").order("supplier_invoice_date", { ascending: false }).limit(150);
  if (opts.poIds?.length) q = q.in("id", opts.poIds);
  const { data: pos } = await q;
  const list = (pos ?? []) as { id: string; number: string; job_id: string | null; supplier_id: string | null; supplier_name: string; supplier_invoice_number: string | null; supplier_invoice_date: string | null }[];
  if (!list.length) return [];
  const ids = list.map((p) => p.id);
  const [{ data: parts }, { data: lines }, { data: sups }, { data: jobs }] = await Promise.all([
    admin.from("part_items").select("id, po_id, po_line_id, description, quantity, confirmed_quantity, received_qty, returned_qty, disposition, is_active, cost_aed").in("po_id", ids),
    admin.from("purchase_order_lines").select("id, unit_cost, invoice_unit_cost").in("po_id", ids),
    admin.from("suppliers").select("id, name, trn, vat_registered").in("id", Array.from(new Set(list.map((p) => p.supplier_id).filter((x): x is string => !!x)))),
    admin.from("jobs").select("id, job_number").in("id", Array.from(new Set(list.map((p) => p.job_id).filter((x): x is string => !!x)))),
  ]);
  const lineOf = new Map(((lines ?? []) as { id: string; unit_cost: number | string; invoice_unit_cost: number | string | null }[]).map((l) => [l.id, Number(l.invoice_unit_cost ?? l.unit_cost) || 0]));
  const supOf = new Map(((sups ?? []) as { id: string; name: string; trn: string | null; vat_registered: boolean | null }[]).map((s) => [s.id, s]));
  const jobOf = new Map(((jobs ?? []) as { id: string; job_number: string }[]).map((j) => [j.id, j.job_number]));
  return list
    .map((po) => {
      const s = po.supplier_id ? supOf.get(po.supplier_id) : null;
      const ps = ((parts ?? []) as Record<string, unknown>[])
        .filter((p) => p.po_id === po.id && ((p.is_active && Number(p.received_qty) > 0 && !p.disposition) || p.disposition === "return_pending"))
        .map((p) => ({ id: String(p.id), name: String(p.description), qty: Number(p.returned_qty) || Number(p.received_qty) || Number(p.confirmed_quantity ?? p.quantity) || 1, unit: round2(lineOf.get(String(p.po_line_id ?? "")) ?? (Number(p.cost_aed) || 0)), state: p.disposition === "return_pending" ? "going back, credit awaited" : "received" }));
      return { poId: po.id, jobId: po.job_id, label: `${po.supplier_name} · invoice ${po.supplier_invoice_number ?? "?"}${po.supplier_invoice_date ? ` (${String(po.supplier_invoice_date).slice(0, 10)})` : ""} · ${po.number}${po.job_id && jobOf.get(po.job_id) ? ` · ${jobOf.get(po.job_id)}` : ""}`, chargesVat: supplierChargesVat({ name: po.supplier_name, trn: s?.trn ?? null, vat_registered: s?.vat_registered !== false }), parts: ps };
    })
    .filter((o) => o.parts.length);
}

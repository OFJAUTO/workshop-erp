"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";
import { dbWords, logAppError } from "@/lib/app-errors";
import { notifyJobAdvisors, notifyRoles } from "@/lib/notifications";
import { purchaseReturnsReady } from "@/lib/purchase-returns";
import { recordCreditNote } from "@/lib/part-endings-server";
import { addPartToStock } from "@/lib/stock";
import { round2 } from "@/lib/money";

export type ReturnAnswer = { error?: string; message?: string };

const day = (v: FormDataEntryValue | null) => { const t = String(v ?? "").slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null; };
const money = (v: FormDataEntryValue | null) => { const n = Number(String(v ?? "").replace(/,/g, "").trim()); return Number.isFinite(n) && String(v ?? "").trim() !== "" ? round2(n) : null; };
const text = (v: FormDataEntryValue | null, max = 300) => String(v ?? "").trim().slice(0, max);
const today = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);

async function load(id: string) {
  const { data } = await createAdminClient().from("purchase_returns").select("*").eq("id", id).eq("is_active", true).maybeSingle();
  return data as Record<string, unknown> | null;
}
function refresh(r: Record<string, unknown>) {
  revalidatePath("/parts/returns");
  revalidatePath("/parts/suppliers");
  revalidatePath("/parts-accounts");
  if (r.job_id) revalidatePath(`/parts/${r.job_id}`);
  if (r.po_id) revalidatePath(`/parts/orders/${r.po_id}`);
}
async function event(r: Record<string, unknown>, note: string, by: string) {
  if (r.job_id) await createAdminClient().from("job_events").insert({ job_id: r.job_id, event_type: "purchase_return", note: `${r.number}: ${note}`, created_by: by });
}

/** Parts (or the owner): fewer pieces than first thought go back - while it has not gone yet. */
export async function setReturnQuantity(id: string, formData: FormData): Promise<ReturnAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs || !can(staff.role_id as RoleId, "managePurchaseOrders")) return { error: "Only Parts or the owner change a return." };
  if (!(await purchaseReturnsReady())) return { error: "Purchase returns are waiting for the database update." };
  const r = await load(id);
  if (!r || r.status !== "requested") return { error: "This return has already gone back." };
  const q = money(formData.get("quantity"));
  if (!q || q <= 0) return { error: "Type how many go back (more than 0)." };
  const { data: p } = await createAdminClient().from("part_items").select("received_qty, quantity, confirmed_quantity").eq("id", r.part_item_id).maybeSingle();
  const max = Number(p?.received_qty) || Number(p?.confirmed_quantity ?? p?.quantity) || Number(r.quantity) || 1;
  if (q > max + 0.001) return { error: `Only ${max} arrived, so at most ${max} can go back.` };
  const { error } = await createAdminClient().from("purchase_returns").update({ quantity: q, updated_by: staff.id }).eq("id", id).eq("status", "requested");
  if (error) return { error: dbWords(error, "returns/quantity") };
  await event(r, `quantity going back set to ${q} (${staff.display_name})`, staff.id);
  refresh(r);
  return { message: `${r.number}: ${q} going back.` };
}

/** SENT BACK: when, who took it (or the supplier's driver who collected it), the signed slip. Accounts are told. */
export async function markReturnSent(id: string, formData: FormData): Promise<ReturnAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs || !can(staff.role_id as RoleId, "managePurchaseOrders")) return { error: "Only Parts or the owner send a return." };
  if (!(await purchaseReturnsReady())) return { error: "Purchase returns are waiting for the database update." };
  const r = await load(id);
  if (!r || r.status !== "requested") return { error: "This return has already gone back." };
  const on = day(formData.get("sent_on"));
  const who = text(formData.get("sent_with"), 120);
  // The signed slip is uploaded through THE upload door onto this return (job file kind return_photo, ref = the PR).
  const { data: slipRow } = r.job_id ? await createAdminClient().from("job_files").select("storage_path").eq("job_id", r.job_id).eq("kind", "return_photo").eq("ref_id", id).is("removed_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
  const slip = text(formData.get("slip_path"), 400) || ((slipRow?.storage_path as string | undefined) ?? null);
  if (!on || on > today()) return { error: "Pick the day it went back (not in the future)." };
  if (who.length < 2) return { error: "Who took it back, or who from the supplier collected it?" };
  const { data, error } = await createAdminClient().from("purchase_returns").update({ status: "sent", sent_at: new Date(`${on}T12:00:00+04:00`).toISOString(), sent_by: staff.id, sent_with: who, slip_path: slip, updated_by: staff.id }).eq("id", id).eq("status", "requested").select("id");
  if (error) return { error: dbWords(error, "returns/sent") };
  if (!(data ?? []).length) return { error: "Someone else updated this return. Reload the page." };
  await event(r, `sent back on ${on} with ${who}${slip ? " (signed slip attached)" : ""} by ${staff.display_name}`, staff.id);
  await notifyRoles(["accounts"], { type: "purchase_return", title: `Part going back: ${r.number} · ${r.supplier_name}`, body: `${String(r.description).toUpperCase()} × ${r.quantity} went back on ${on}. A credit is expected from ${r.supplier_name}: record it on Purchase returns when the credit note arrives.`, jobId: (r.job_id as string | null) ?? null, href: `/parts/returns?tab=credit#${r.number}` });
  refresh(r);
  return { message: `${r.number} sent back ✓ — accounts have been told a credit is expected.` };
}

/** CREDIT RECEIVED (accounts or the owner): the supplier's credit note as printed. The supplier balance moves now. */
export async function recordReturnCredit(id: string, formData: FormData): Promise<ReturnAnswer> {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (staff.viewingAs || !(role === "owner" || role === "accounts")) return { error: "Only accounts or the owner record a supplier's credit." };
  if (!(await purchaseReturnsReady())) return { error: "Purchase returns are waiting for the database update." };
  const r = await load(id);
  if (!r || (r.status !== "sent" && r.status !== "requested")) return { error: "This return is already closed." };
  const number = text(formData.get("credit_number"), 60);
  const on = day(formData.get("credit_date"));
  const net = money(formData.get("credit_net"));
  const vat = money(formData.get("credit_vat")) ?? 0;
  const { data: scanRow } = r.job_id ? await createAdminClient().from("job_files").select("storage_path").eq("job_id", r.job_id).eq("kind", "supplier_invoice").eq("ref_id", id).is("removed_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle() : { data: null };
  const scan = text(formData.get("credit_scan_path"), 400) || ((scanRow?.storage_path as string | undefined) ?? null);
  const fee = money(formData.get("restock_fee")) ?? 0;
  if (number.length < 2) return { error: "Type the supplier's credit note number." };
  if (!on || on > today()) return { error: "Pick the credit note's date (not in the future)." };
  if (net === null || net <= 0) return { error: "Type the credit before VAT, as printed." };
  if (vat < 0 || fee < 0) return { error: "The VAT and the restocking fee cannot be below 0." };
  // THE 3 November credit note path: the part's ending becomes "returned" and the Zoho vendor credit is queued.
  const { data: part } = await createAdminClient().from("part_items").select("job_id, disposition").eq("id", r.part_item_id).maybeSingle();
  if (part?.disposition !== "returned") {
    const done = await recordCreditNote(String(part?.job_id ?? r.job_id ?? ""), String(r.part_item_id), { number, path: scan, amount: round2(net + vat), date: on }, staff);
    if (done.error && !/already recorded/i.test(done.error)) return { error: done.error };
  }
  const { data, error } = await createAdminClient().from("purchase_returns").update({ status: "credited", credit_number: number, credit_date: on, credit_net_aed: net, credit_vat_aed: vat, credit_scan_path: scan, restock_fee_aed: fee, cost_to: fee > 0 ? (text(formData.get("cost_to"), 10) === "job" ? "job" : "overhead") : null, closed_at: new Date().toISOString(), closed_by: staff.id, updated_by: staff.id }).eq("id", id).in("status", ["sent", "requested"]).select("id");
  if (error) return { error: dbWords(error, "returns/credit") };
  if (!(data ?? []).length) return { error: "Someone else closed this return. Reload the page." };
  await event(r, `credit note ${number} of ${on}: AED ${net.toFixed(2)} + VAT ${vat.toFixed(2)}${fee ? `, restocking fee AED ${fee.toFixed(2)}` : ""} (${staff.display_name})`, staff.id);
  refresh(r);
  return { message: `${r.number}: credit note ${number} recorded ✓ — the supplier balance is AED ${round2(net + vat).toFixed(2)} lower.` };
}

/** REFUND RECEIVED (accounts or the owner): money back instead of a credit note. Entered in Zoho by hand. */
export async function recordReturnRefund(id: string, formData: FormData): Promise<ReturnAnswer> {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  if (staff.viewingAs || !(role === "owner" || role === "accounts")) return { error: "Only accounts or the owner record a refund." };
  if (!(await purchaseReturnsReady())) return { error: "Purchase returns are waiting for the database update." };
  const r = await load(id);
  if (!r || (r.status !== "sent" && r.status !== "requested")) return { error: "This return is already closed." };
  const method = text(formData.get("refund_method"), 10);
  const on = day(formData.get("refund_date"));
  const amount = money(formData.get("refund_amount"));
  const fee = money(formData.get("restock_fee")) ?? 0;
  if (!["transfer", "card", "cash", "cheque"].includes(method)) return { error: "Pick how the supplier paid it back." };
  if (!on || on > today()) return { error: "Pick the day the refund arrived (not in the future)." };
  if (amount === null || amount <= 0) return { error: "Type the amount refunded." };
  const admin = createAdminClient();
  const { data, error } = await admin.from("purchase_returns").update({ status: "refunded", refund_method: method, refund_date: on, refund_aed: amount, restock_fee_aed: fee, cost_to: fee > 0 ? (text(formData.get("cost_to"), 10) === "job" ? "job" : "overhead") : null, closed_at: new Date().toISOString(), closed_by: staff.id, updated_by: staff.id }).eq("id", id).in("status", ["sent", "requested"]).select("id");
  if (error) return { error: dbWords(error, "returns/refund") };
  if (!(data ?? []).length) return { error: "Someone else closed this return. Reload the page." };
  await admin.from("part_items").update({ disposition: "returned", disposition_note: `Refund ${method} ${on}`, return_status: "returned", updated_by: staff.id }).eq("id", r.part_item_id).eq("disposition", "return_pending");
  await event(r, `refund of AED ${amount.toFixed(2)} by ${method} on ${on}${fee ? `, restocking fee AED ${fee.toFixed(2)}` : ""} (${staff.display_name}) – enter it in Zoho Books by hand`, staff.id);
  refresh(r);
  return { message: `${r.number}: refund AED ${amount.toFixed(2)} recorded ✓. Enter the supplier refund in Zoho Books by hand.` };
}

/** REPLACED: the supplier sent the right part instead of a credit. */
export async function markReturnReplaced(id: string, formData: FormData): Promise<ReturnAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs || !can(staff.role_id as RoleId, "managePurchaseOrders")) return { error: "Only Parts or the owner close a return." };
  if (!(await purchaseReturnsReady())) return { error: "Purchase returns are waiting for the database update." };
  const r = await load(id);
  if (!r || (r.status !== "sent" && r.status !== "requested")) return { error: "This return is already closed." };
  const replacement = text(formData.get("replacement_part_id"), 40) || null;
  const note = text(formData.get("note"));
  const admin = createAdminClient();
  const { data, error } = await admin.from("purchase_returns").update({ status: "replaced", replacement_part_id: replacement, outcome_note: note || null, closed_at: new Date().toISOString(), closed_by: staff.id, updated_by: staff.id }).eq("id", id).in("status", ["sent", "requested"]).select("id");
  if (error) return { error: dbWords(error, "returns/replaced") };
  if (!(data ?? []).length) return { error: "Someone else closed this return. Reload the page." };
  await admin.from("part_items").update({ disposition: "returned", disposition_note: "Replaced by the supplier", return_status: "returned", updated_by: staff.id }).eq("id", r.part_item_id).eq("disposition", "return_pending");
  await event(r, `replaced by the supplier${note ? `: ${note}` : ""} (${staff.display_name})`, staff.id);
  refresh(r);
  return { message: `${r.number}: replaced by the supplier ✓ (no credit to wait for).` };
}

/**
 * REFUSED BY THE SUPPLIER: back to our stock at its cost, or written off - a write-off waits for the owner. The cost
 * goes to the job or to overhead, as the owner chooses (the parts desk proposes, the owner decides on a write-off).
 */
export async function markReturnRefused(id: string, formData: FormData): Promise<ReturnAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs || !can(staff.role_id as RoleId, "managePurchaseOrders")) return { error: "Only Parts or the owner close a return." };
  if (!(await purchaseReturnsReady())) return { error: "Purchase returns are waiting for the database update." };
  const r = await load(id);
  if (!r || (r.status !== "sent" && r.status !== "requested")) return { error: "This return is already closed." };
  const action = text(formData.get("refused_action"), 12);
  const note = text(formData.get("note"));
  if (action !== "stock" && action !== "write_off") return { error: "Back to our stock, or written off?" };
  if (note.length < 3) return { error: "Write why the supplier refused it." };
  const admin = createAdminClient();
  const owner = staff.role_id === "owner";
  const { data, error } = await admin.from("purchase_returns").update({ status: "refused", refused_action: action, write_off_status: action === "write_off" ? (owner ? "approved" : "pending") : null, write_off_decided_by: action === "write_off" && owner ? staff.id : null, write_off_decided_at: action === "write_off" && owner ? new Date().toISOString() : null, cost_to: action === "write_off" ? (text(formData.get("cost_to"), 10) === "job" ? "job" : "overhead") : null, outcome_note: note, closed_at: new Date().toISOString(), closed_by: staff.id, updated_by: staff.id }).eq("id", id).in("status", ["sent", "requested"]).select("id");
  if (error) return { error: dbWords(error, "returns/refused") };
  if (!(data ?? []).length) return { error: "Someone else closed this return. Reload the page." };
  if (action === "stock") {
    try {
      const { data: part } = await admin.from("part_items").select("id, description, part_number, cost_aed, quantity, confirmed_quantity, supplier").eq("id", r.part_item_id).maybeSingle();
      if (part) await addPartToStock({ ...part, quantity: Number(r.quantity) || 1, confirmed_quantity: Number(r.quantity) || 1, cost_aed: Number(r.unit_cost) || part.cost_aed } as never, staff as never, (r.job_id as string | null) ?? null);
      await admin.from("part_items").update({ disposition: "stock", disposition_note: `Refused by the supplier: ${note}`, return_status: "none", updated_by: staff.id }).eq("id", r.part_item_id);
    } catch (e) {
      await logAppError("returns/refused-stock", e, { staffId: staff.id, jobId: (r.job_id as string | null) ?? null });
    }
  } else if (!owner) {
    await notifyRoles(["owner"], { type: "purchase_return", title: `Write-off to approve: ${r.number} · ${r.supplier_name}`, body: `${String(r.description).toUpperCase()} × ${r.quantity} (AED ${round2((Number(r.quantity) || 0) * (Number(r.unit_cost) || 0)).toFixed(2)}) was refused by ${r.supplier_name}: ${note}. Approve the write-off on Purchase returns.`, jobId: (r.job_id as string | null) ?? null, href: `/parts/returns?tab=refused#${r.number}` });
  }
  if (r.job_id) await notifyJobAdvisors(String(r.job_id), { type: "purchase_return", title: `Return refused by ${r.supplier_name}: ${String(r.description).toUpperCase()}`, body: `${r.number}: ${note}. ${action === "stock" ? "The part went into our stock." : "It is written off."} The customer's documents are not changed.`, jobId: String(r.job_id), href: `/jobs/${r.job_id}` });
  await event(r, `refused by the supplier (${note}) – ${action === "stock" ? "back to our stock at cost" : owner ? "written off (owner)" : "write-off waiting for the owner"} (${staff.display_name})`, staff.id);
  refresh(r);
  return { message: `${r.number}: refused by the supplier ✓ — ${action === "stock" ? "back in our stock at its cost." : owner ? "written off." : "the write-off waits for the owner."}` };
}

/** The owner decides a write-off, and where its cost goes (the job or overhead). */
export async function decideReturnWriteOff(id: string, formData: FormData): Promise<ReturnAnswer> {
  const staff = await requireStaff();
  if (staff.viewingAs || staff.role_id !== "owner") return { error: "Only the owner approves a write-off." };
  const r = await load(id);
  if (!r || r.status !== "refused" || r.write_off_status !== "pending") return { error: "Nothing waits for a decision here." };
  const ok = text(formData.get("decision"), 10) === "approve";
  const { error } = await createAdminClient().from("purchase_returns").update({ write_off_status: ok ? "approved" : "declined", write_off_decided_by: staff.id, write_off_decided_at: new Date().toISOString(), cost_to: text(formData.get("cost_to"), 10) === "job" ? "job" : "overhead", updated_by: staff.id }).eq("id", id).eq("write_off_status", "pending");
  if (error) return { error: dbWords(error, "returns/write-off") };
  await event(r, `write-off ${ok ? "approved" : "declined"} by ${staff.display_name}`, staff.id);
  refresh(r);
  return { message: `${r.number}: write-off ${ok ? "approved" : "declined"}.` };
}

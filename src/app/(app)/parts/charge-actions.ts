"use server";

import { revalidatePath } from "next/cache";
import { logAppError, SAVE_FAILED } from "@/lib/app-errors";
import { getCurrentStaff } from "@/lib/auth";
import { round2 } from "@/lib/money";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

const aed = (n: number) => `AED ${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dubaiDay = () => new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10);

/**
 * Remove a supplier charge (courier, freight) that should not be there. One already on an LPO stays: it is on the
 * supplier's paper - except (3 November 2026, section 7) when every part of that LPO was cancelled with the supplier
 * and the supplier waived the charge: "Waived – remove" takes it off, the LPO's total follows, and an LPO left with
 * nothing at all is cancelled (it no longer waits for an invoice). Never once the supplier's invoice is entered, paid
 * or in Zoho Books.
 */
export async function removeSupplierCharge(jobId: string, chargeId: string): Promise<{ error?: string; ok?: boolean; message?: string }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || !can(staff.role_id as RoleId, "priceParts")) return { error: "Not allowed." };
  const admin = createAdminClient();
  const { data: c, error: readErr } = await admin.from("supplier_charges").select("id, job_id, po_id, description, amount_aed, supplier_name").eq("id", chargeId).eq("is_active", true).maybeSingle();
  if (readErr) {
    await logAppError("supplier_charge_remove", readErr, { staffId: staff.id, jobId, detail: { chargeId } });
    return { error: SAVE_FAILED };
  }
  if (!c || c.job_id !== jobId) return { error: "Charge not found." };
  const desc = String(c.description ?? "").toUpperCase();
  const amount = Number(c.amount_aed) || 0;
  let po: { id: string; number: string; status: string; notes: string | null; total_cost_aed: number; supplier_invoice_status: string | null } | null = null;
  let others = 0;
  if (c.po_id) {
    const [{ data: poRow, error: poErr }, { data: lines, error: lErr }, { data: rest, error: rErr }] = await Promise.all([
      admin.from("purchase_orders").select("id, number, status, notes, total_cost_aed, supplier_invoice_status, supplier_paid_at, zoho_bill_id").eq("id", c.po_id).maybeSingle(),
      admin.from("purchase_order_lines").select("id").eq("po_id", c.po_id).eq("is_active", true).limit(1),
      admin.from("supplier_charges").select("id, amount_aed").eq("po_id", c.po_id).eq("is_active", true).neq("id", chargeId),
    ]);
    if (poErr || lErr || rErr) {
      await logAppError("supplier_charge_remove", poErr ?? lErr ?? rErr, { staffId: staff.id, jobId, detail: { chargeId, step: "read the LPO" } });
      return { error: SAVE_FAILED };
    }
    if (!poRow) return { error: "This charge's LPO is not found." };
    if ((lines ?? []).length) return { error: `This charge is on ${poRow.number}, which still has parts on it: it stays on the supplier's paper.` };
    if (poRow.supplier_invoice_status === "received" || poRow.supplier_paid_at || poRow.zoho_bill_id) return { error: `${poRow.number}'s supplier invoice is already entered or paid: the charge stays. Tell accounts if the supplier waived it.` };
    po = { id: String(poRow.id), number: String(poRow.number), status: String(poRow.status), notes: (poRow.notes as string | null) ?? null, total_cost_aed: Number(poRow.total_cost_aed) || 0, supplier_invoice_status: (poRow.supplier_invoice_status as string | null) ?? null };
    others = round2((rest ?? []).reduce((a, r) => a + (Number(r.amount_aed) || 0), 0));
  }
  const now = new Date().toISOString();
  const { data: done, error: upErr } = await admin.from("supplier_charges").update({ is_active: false, removed_at: now, removed_by: staff.id, updated_by: staff.id }).eq("id", chargeId).eq("is_active", true).select("id");
  if (upErr) {
    await logAppError("supplier_charge_remove", upErr, { staffId: staff.id, jobId, detail: { chargeId, step: "remove the charge" } });
    return { error: SAVE_FAILED };
  }
  if (!done?.length) return { error: "This charge was removed a moment ago by someone else." };
  let lpoWords = "";
  if (po) {
    // The LPO had no part left: its total is what charges remain; with none at all it is cancelled.
    const empty = others <= 0.005;
    const note = `${dubaiDay()} · ${desc} (${aed(amount)}) waived by the supplier – removed by ${staff.display_name}${empty ? ". Nothing left: this LPO is cancelled." : ""}`;
    const patch: Record<string, unknown> = { total_cost_aed: others, notes: [po.notes, note].filter(Boolean).join("\n"), updated_by: staff.id };
    if (empty) patch.status = "cancelled";
    if (empty && po.supplier_invoice_status === "to_follow") patch.supplier_invoice_status = "none";
    const { error: poUpErr } = await admin.from("purchase_orders").update(patch).eq("id", po.id);
    if (poUpErr) {
      // Put the charge back: never a charge gone from an LPO whose total still counts it.
      await admin.from("supplier_charges").update({ is_active: true, removed_at: null, removed_by: null, updated_by: staff.id }).eq("id", chargeId);
      await logAppError("supplier_charge_remove", poUpErr, { staffId: staff.id, jobId, detail: { chargeId, step: "write the LPO" } });
      return { error: SAVE_FAILED };
    }
    lpoWords = empty ? ` ${po.number} has nothing left: cancelled.` : ` ${po.number} total now ${aed(others)}.`;
  }
  const { error: evErr } = await admin.from("job_events").insert({ job_id: jobId, event_type: "supplier_charge_removed", note: `${desc} (${c.supplier_name}, ${aed(amount)}) ${po ? `waived by the supplier, taken off ${po.number}` : "removed"} by ${staff.display_name}`, created_by: staff.id });
  if (evErr) await logAppError("supplier_charge_remove", evErr, { staffId: staff.id, jobId, detail: { chargeId, step: "job event" } });
  revalidatePath(`/parts/${jobId}`);
  if (po) revalidatePath(`/parts/orders/${po.id}`);
  return { ok: true, message: `${desc} (${aed(amount)}) removed.${lpoWords}` };
}

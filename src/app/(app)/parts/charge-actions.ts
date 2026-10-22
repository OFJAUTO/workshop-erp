"use server";

import { revalidatePath } from "next/cache";
import { getCurrentStaff } from "@/lib/auth";
import { can, type RoleId } from "@/lib/roles";
import { createAdminClient } from "@/lib/supabase/admin";

/** Remove a supplier charge (courier, freight) that should not be there. One already on an LPO stays: it is on the supplier's paper. */
export async function removeSupplierCharge(jobId: string, chargeId: string): Promise<{ error?: string; ok?: boolean }> {
  const staff = await getCurrentStaff();
  if (!staff || staff.viewingAs || !can(staff.role_id as RoleId, "priceParts")) return { error: "Not allowed." };
  const admin = createAdminClient();
  const { data: c } = await admin.from("supplier_charges").select("id, job_id, po_id, description, amount_aed, supplier_name").eq("id", chargeId).eq("is_active", true).maybeSingle();
  if (!c || c.job_id !== jobId) return { error: "Charge not found." };
  if (c.po_id) return { error: "This charge is already on an LPO sent for approval or to the supplier." };
  const now = new Date().toISOString();
  await admin.from("supplier_charges").update({ is_active: false, removed_at: now, removed_by: staff.id, updated_by: staff.id }).eq("id", chargeId);
  await admin.from("job_events").insert({ job_id: jobId, event_type: "supplier_charge_removed", note: `${c.description} (${c.supplier_name}, AED ${Number(c.amount_aed).toLocaleString("en-GB", { minimumFractionDigits: 2 })}) removed by ${staff.display_name}`, created_by: staff.id });
  revalidatePath(`/parts/${jobId}`);
  return { ok: true };
}

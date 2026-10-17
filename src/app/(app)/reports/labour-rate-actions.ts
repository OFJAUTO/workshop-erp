"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";

/** Accounts (or the owner) type the month's all-in technician cost per department side. */
export async function saveLabourActuals(month: string, formData: FormData) {
  const staff = await requireStaff();
  if (!["owner", "accounts"].includes(staff.role_id) || staff.viewingAs) redirect(`/reports/labour-rate?error=${encodeURIComponent("Only the owner and accounts type the figures.")}`);
  if (!/^\d{4}-\d{2}$/.test(month)) redirect(`/reports/labour-rate?error=${encodeURIComponent("Bad month.")}`);
  const mech = Number(String(formData.get("mechanical") ?? "").replace(/[^\d.]/g, ""));
  const body = Number(String(formData.get("bodyshop") ?? "").replace(/[^\d.]/g, ""));
  const settings = await getSettings();
  const all = { ...((settings.labour_cost_actuals ?? {}) as Record<string, Record<string, number>>) };
  all[month] = { mechanical: Number.isFinite(mech) ? Math.round(mech) : 0, bodyshop: Number.isFinite(body) ? Math.round(body) : 0 };
  await createAdminClient().from("settings").update({ value: all, updated_by: staff.id }).eq("key", "labour_cost_actuals");
  revalidatePath("/reports/labour-rate");
  redirect(`/reports/labour-rate?month=${month}&message=${encodeURIComponent("Saved. The real rate is worked out from the clocked hours.")}`);
}

const SIDE_DEPARTMENTS: Record<"mechanical" | "bodyshop", string[]> = {
  mechanical: ["mechanical"],
  bodyshop: ["bodyshop", "paint", "ppf_tint", "detailing"],
};

/** The owner's "Use this rate": every job profit and the target box recalculate from it. */
export async function useLabourRate(side: "mechanical" | "bodyshop", month: string, rateIn: number, formData: FormData) {
  void formData;
  const staff = await requireStaff();
  if (staff.role_id !== "owner" || staff.viewingAs) redirect(`/reports/labour-rate?error=${encodeURIComponent("Only the owner sets the rate.")}`);
  const rate = Math.round(Number(rateIn));
  if (!(rate > 0) || rate > 10000) redirect(`/reports/labour-rate?error=${encodeURIComponent("The rate must be a number of dirhams per hour.")}`);
  const settings = await getSettings();
  const byDept = { ...((settings.technician_cost_rate_by_department ?? {}) as Record<string, number>) };
  for (const d of SIDE_DEPARTMENTS[side]) byDept[d] = rate;
  const admin = createAdminClient();
  await admin.from("settings").update({ value: byDept, updated_by: staff.id }).eq("key", "technician_cost_rate_by_department");
  await admin.from("audit_log").insert({ table_name: "settings", record_id: "technician_cost_rate_by_department", action: "update", new_data: { side, rate, from: `labour rate check ${month}` }, changed_by: staff.id }).then(() => null, () => null);
  revalidatePath("/reports/labour-rate");
  revalidatePath("/dashboard");
  redirect(`/reports/labour-rate?month=${month}&message=${encodeURIComponent(`The ${side} cost rate is now AED ${rate}/h. Job profits and the target box use it from now on.`)}`);
}

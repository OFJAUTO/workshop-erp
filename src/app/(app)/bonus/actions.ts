"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { bonusRowsOf } from "@/lib/advisor-bonus";
import { requireStaff } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";

/** Only the owner approves or changes bonuses. */
async function owner() {
  const staff = await requireStaff();
  if (staff.role_id !== "owner" || staff.viewingAs) redirect(`/bonus?error=${encodeURIComponent("Only the owner approves or changes bonuses.")}`);
  return staff;
}

/** The owner's per-invoice override: more, less or zero, with a short reason. */
export async function setBonusOverride(invoiceId: string, formData: FormData) {
  const staff = await owner();
  const rate = Number(String(formData.get("rate") ?? "").replace(/[^\d.]/g, ""));
  const reason = blankToNull(formData.get("reason"));
  const period = blankToNull(formData.get("period"));
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) redirect(`/bonus?error=${encodeURIComponent("The rate is a percent between 0 and 100.")}`);
  if (!reason) redirect(`/bonus?error=${encodeURIComponent("Write a short reason for the change.")}`);
  const admin = createAdminClient();
  await admin.from("advisor_bonus_overrides").upsert({ invoice_id: invoiceId, rate_percent: rate, reason, created_by: staff.id, updated_by: staff.id }, { onConflict: "invoice_id" });
  revalidatePath("/bonus");
  redirect(`/bonus?${period ? `period=${period}&` : ""}message=${encodeURIComponent(`Rate set to ${rate}%.`)}`);
}

/** "Approve bonuses for this period": the live rows freeze exactly as they are. */
export async function approveBonusPeriod(formData: FormData) {
  const staff = await owner();
  const periodKey = String(formData.get("period") ?? "");
  if (!/^\d{4}-\d{2}$/.test(periodKey)) redirect(`/bonus?error=${encodeURIComponent("Pick the period.")}`);
  const settings = await getSettings();
  const view = await bonusRowsOf(settings, periodKey);
  if (view.approved) redirect(`/bonus?period=${periodKey}&message=${encodeURIComponent("Already approved.")}`);
  const estimated = view.rows.filter((r) => r.cardFeeEstimated).length;
  if (estimated && formData.get("confirm_estimated") !== "1") redirect(`/bonus?period=${periodKey}&error=${encodeURIComponent(`${estimated} invoice${estimated === 1 ? " still has an" : "s still have"} estimated card fee. Tick "Approve anyway" to freeze them as they are, or record the bank settlement first.`)}`);
  const admin = createAdminClient();
  await admin.from("advisor_bonus_periods").insert({ period: periodKey, rows: view.rows, total_aed: view.total, approved_by: staff.id, created_by: staff.id, updated_by: staff.id });
  revalidatePath("/bonus");
  redirect(`/bonus?period=${periodKey}&message=${encodeURIComponent(`Approved: AED ${view.total.toLocaleString("en-GB")} for ${view.period.label}.`)}`);
}

"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { TERMS_KEYS, termsOf, type WarrantyTerms } from "@/lib/warranty";

/** The owner's warranty terms. The PPF period and text also feed the older PPF settings, so every reader agrees. */
export async function saveWarrantyTerms(formData: FormData) {
  const staff = await requireStaff();
  if (staff.role_id !== "owner" || staff.viewingAs) redirect(`/settings/warranty?error=${encodeURIComponent("Owner only.")}`);
  const raw: Record<string, { months: number; short: string; full: string }> = {};
  for (const k of TERMS_KEYS) {
    const months = Math.round(Number(String(formData.get(`${k}_months`) ?? "").replace(",", ".")));
    if (!Number.isFinite(months) || months < 1 || months > 600) redirect(`/settings/warranty?error=${encodeURIComponent("Each warranty period is a number of months between 1 and 600.")}`);
    raw[k] = { months, short: String(formData.get(`${k}_short`) ?? "").trim().slice(0, 600), full: String(formData.get(`${k}_full`) ?? "").trim().slice(0, 6000) };
  }
  const terms: WarrantyTerms = termsOf(raw);
  const admin = createAdminClient();
  const upsert = (key: string, label: string, value: unknown) => admin.from("settings").upsert({ key, label, value, updated_by: staff.id }, { onConflict: "key" });
  await upsert("warranty_terms", "Warranty terms per product (owner)", terms);
  if (terms.ppf.months % 12 === 0) await upsert("ppf_warranty_years", "PPF warranty (years)", terms.ppf.months / 12);
  await upsert("ppf_warranty_text", "PPF warranty wording", terms.ppf.full);
  revalidatePath("/settings/warranty");
  revalidatePath("/settings");
  redirect(`/settings/warranty?message=${encodeURIComponent("Warranty terms saved.")}`);
}

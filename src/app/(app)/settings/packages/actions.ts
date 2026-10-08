"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { blankToNull } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

/** Owner adds or edits a fixed-price package the advisor can pick on a quotation. */
export async function savePackage(id: string | null, formData: FormData) {
  const staff = await requirePermission("managePackages");
  const name = String(formData.get("name") ?? "").trim();
  const department = String(formData.get("department") ?? "both");
  const price = Number(String(formData.get("price_aed") ?? "").replace(/[^\d.]/g, ""));
  const description = blankToNull(formData.get("description"));
  const back = (msg: string, isError = false) => redirect(`/settings/packages?${isError ? "error" : "message"}=${encodeURIComponent(msg)}`);
  if (name.length < 2) back("Enter the package name.", true);
  if (!["mechanical", "bodyshop", "both"].includes(department)) back("Choose the department.", true);
  if (!Number.isFinite(price) || price < 0) back("Enter the price in AED.", true);
  const admin = createAdminClient();
  const row = { name, department, price_aed: price, description, updated_by: staff.id };
  const { error } = id ? await admin.from("packages").update(row).eq("id", id) : await admin.from("packages").insert({ ...row, created_by: staff.id });
  if (error) back(error.message, true);
  revalidatePath("/settings/packages");
  back(id ? "Package saved." : "Package added.");
}

export async function setPackageActive(id: string, active: boolean) {
  const staff = await requirePermission("managePackages");
  const admin = createAdminClient();
  await admin.from("packages").update({ is_active: active, updated_by: staff.id }).eq("id", id);
  revalidatePath("/settings/packages");
  redirect(`/settings/packages?message=${encodeURIComponent(active ? "Package shown again." : "Package hidden from quotations.")}`);
}

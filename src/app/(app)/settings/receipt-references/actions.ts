"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { receiptRefTypes } from "@/lib/receipts";
import { refKeyOf, type RefType } from "@/lib/receipt-refs";

/** Owner and accounts: which reference types count as the supplier's invoice, and new types (15 November 2026). */
export async function saveRefTypesAction(formData: FormData) {
  const staff = await requireStaff();
  const back = "/settings/receipt-references";
  if (!["owner", "accounts"].includes(staff.role_id) || staff.viewingAs) redirect(`${back}?error=${encodeURIComponent("Only the owner or accounts change the reference types.")}`);
  const have = await receiptRefTypes();
  const next: RefType[] = have.map((t) => ({
    key: t.key,
    label: t.builtin ? t.label : String(formData.get(`label__${t.key}`) ?? t.label).trim().slice(0, 60) || t.label,
    counts: formData.get(`counts__${t.key}`) === "on",
  }));
  const added = String(formData.get("new_label") ?? "").trim().slice(0, 60);
  if (added) {
    let key = refKeyOf(added);
    while (next.some((t) => t.key === key)) key = `${key}_2`;
    if (next.some((t) => t.label.toLowerCase() === added.toLowerCase())) redirect(`${back}?error=${encodeURIComponent(`"${added}" is already on the list.`)}`);
    next.push({ key, label: added, counts: formData.get("new_counts") === "on" });
  }
  const { error } = await createAdminClient().from("settings").upsert({ key: "supplier_ref_types", label: "Supplier reference types at receiving", value: next, updated_by: staff.id }, { onConflict: "key" });
  if (error) redirect(`${back}?error=${encodeURIComponent("Couldn't save – nothing was changed. Try again.")}`);
  // The settings audit trigger logs who changed it, when, old and new.
  revalidatePath(back);
  redirect(`${back}?message=${encodeURIComponent(`Saved: ${next.filter((t) => t.counts).map((t) => t.label).join(", ") || "no type"} count as the supplier's invoice.`)}`);
}

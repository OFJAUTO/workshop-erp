"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbWords } from "@/lib/app-errors";
import { requirePermission } from "@/lib/auth";
import { readExtraTypes, writeExtraTypes } from "@/lib/sticker-types";
import { createAdminClient } from "@/lib/supabase/admin";

/** The owner's warranty sticker types (11 November 2026, Section 12): one per line "Name = months", "= batch" for a batch number. */
export async function saveWarrantyTypes(formData: FormData) {
  const staff = await requirePermission("manageSettings");
  if (staff.viewingAs) redirect("/labels?tab=warranty&error=" + encodeURIComponent("View as is read-only."));
  const raw = String(formData.get("types") ?? "");
  const types = readExtraTypes(raw);
  const text = writeExtraTypes(types);
  const admin = createAdminClient();
  const { error } = await admin.from("settings").upsert({ key: "sticker_warranty_types", value: text, label: "Warranty sticker types", updated_by: staff.id }, { onConflict: "key" });
  if (error) redirect("/labels?tab=warranty&error=" + encodeURIComponent(dbWords(error, "stickers/saveWarrantyTypes")));
  await admin.from("audit_log").insert({ table_name: "settings", record_id: null, action: "update", new_data: { sticker_warranty_types: text, by: staff.display_name } }).then(() => null, () => null);
  revalidatePath("/labels");
  const dropped = raw.split(/\r?\n/).filter((l) => l.trim()).length - types.length;
  redirect("/labels?tab=warranty&message=" + encodeURIComponent(`Warranty sticker types saved (${types.length}).${dropped > 0 ? ` ${dropped} line${dropped === 1 ? " was" : "s were"} left out: write "Name = months".` : ""}`));
}

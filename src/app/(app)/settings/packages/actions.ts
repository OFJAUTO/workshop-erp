"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { cleanPackages } from "@/lib/packages";
import { createAdminClient } from "@/lib/supabase/admin";

/** The owner saves the bodyshop packages (names, items, warranties, time, the complimentary lines). */
export async function savePackages(payload: unknown): Promise<{ error?: string; ok?: boolean }> {
  const staff = await requirePermission("manageSettings");
  const cleaned = cleanPackages(payload);
  if (Array.isArray(payload) && payload.length && !cleaned.length) return { error: "Every package needs a name." };
  const admin = createAdminClient();
  const { error } = await admin.from("settings").upsert(
    { key: "bodyshop_packages", label: "Bodyshop packages", value: cleaned, updated_by: staff.id },
    { onConflict: "key" },
  );
  if (error) return { error: error.message };
  revalidatePath("/settings/packages");
  return { ok: true };
}

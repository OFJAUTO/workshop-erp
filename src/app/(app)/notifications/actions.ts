"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth";
import { NOTIFICATION_TYPES } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";

export async function savePreferences(formData: FormData) {
  const staff = await requireStaff();
  const supabase = await createClient();
  const rows = NOTIFICATION_TYPES.filter((t) => !t.locked).map((t) => ({
    staff_id: staff.id,
    type: t.type,
    enabled: formData.get(`pref__${t.type}`) === "on",
    updated_at: new Date().toISOString(),
  }));
  await supabase.from("notification_preferences").upsert(rows, { onConflict: "staff_id,type" });
  revalidatePath("/notifications");
  redirect("/notifications");
}

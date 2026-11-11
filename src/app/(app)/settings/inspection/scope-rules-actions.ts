"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { SCOPES } from "@/lib/inspection-scope";
import { createAdminClient } from "@/lib/supabase/admin";

/** Fee (AED) and time allowed (minutes) per inspection type (11 November 2026, Section 10). Empty = today's rule. */
export async function saveScopeRules(formData: FormData) {
  const staff = await requirePermission("manageSettings");
  const num = (k: string) => { const t = String(formData.get(k) ?? "").replace(/,/g, "").trim(); const n = Number(t); return t && Number.isFinite(n) && n >= 0 ? n : null; };
  const value = Object.fromEntries(SCOPES.map((sc) => [sc.key, { fee: num(`fee_${sc.key}`), minutes: num(`minutes_${sc.key}`) }]));
  const { error } = await createAdminClient().from("settings").upsert({ key: "inspection_scope_rules", label: "Inspection types: fee (AED, empty = today's fee rule) and time allowed (minutes) per type", value, updated_by: staff.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  revalidatePath("/settings/inspection");
  redirect(`/settings/inspection?${error ? "error" : "message"}=${encodeURIComponent(error ? "Couldn't save – try again." : "Saved: fee and time per inspection type.")}#scope-rules`);
}

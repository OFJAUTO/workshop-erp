"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VIEW_AS_COOKIE, requirePermission } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/** The owner starts looking at the system as another person (view only). Each use is logged. */
export async function startViewAs(staffId: string) {
  const owner = await requirePermission("viewAs");
  if (owner.viewingAs) redirect("/team");
  const admin = createAdminClient();
  const { data: person } = await admin.from("staff").select("id, display_name, role_id").eq("id", staffId).maybeSingle();
  if (!person) redirect("/team");
  await admin.from("audit_log").insert({ table_name: "view_as", record_id: person.id, action: "VIEW_AS", new_data: { viewed_as: person.display_name, role: person.role_id }, changed_by: owner.id });
  (await cookies()).set(VIEW_AS_COOKIE, person.id, { path: "/", httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 4 });
  redirect("/home");
}

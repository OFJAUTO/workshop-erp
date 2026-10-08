import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { can, type Permission, type RoleId } from "./roles";
import type { StaffRow } from "./types";

export type CurrentStaff = StaffRow & { email: string | null };

/** The logged-in staff member, or null. Cached for the length of one request. */
export const getCurrentStaff = cache(async (): Promise<CurrentStaff | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("staff")
    .select(
      "id, full_name, display_name, role_id, department_id, employee_number, login_type, is_head_accountant, photo_path, colour, is_active, disabled_at, created_at, updated_at",
    )
    .eq("id", user.id)
    .maybeSingle();

  if (!data || !data.is_active) return null;
  return { ...(data as StaffRow), email: user.email ?? null };
});

/** Use at the top of any page that needs a login. Sends strangers to the login page. */
export async function requireStaff(): Promise<CurrentStaff> {
  const staff = await getCurrentStaff();
  if (!staff) redirect("/login");
  return staff;
}

/** Like requireStaff, but also requires a permission. Others are sent home. */
export async function requirePermission(permission: Permission): Promise<CurrentStaff> {
  const staff = await requireStaff();
  if (!can(staff.role_id as RoleId, permission)) redirect("/home");
  return staff;
}

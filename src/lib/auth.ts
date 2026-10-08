import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "./supabase/admin";
import { createClient } from "./supabase/server";
import { can, type Permission, type RoleId } from "./roles";
import type { StaffRow } from "./types";

export const VIEW_AS_COOKIE = "erp_view_as";

export type CurrentStaff = StaffRow & {
  email: string | null;
  /** Set when the owner is looking at the system as someone else (view only). */
  viewingAs: { realId: string; realName: string } | null;
};

const STAFF_COLUMNS = "id, full_name, display_name, role_id, department_id, employee_number, login_type, is_head_accountant, photo_path, colour, is_active, disabled_at, created_at, updated_at";

/**
 * The logged-in staff member, or null. Cached for the length of one request.
 * With the owner's "View as" cookie set, the screens behave for the chosen person's role,
 * while the database still answers as the owner and every change is blocked by the proxy.
 */
export const getCurrentStaff = cache(async (): Promise<CurrentStaff | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("staff").select(STAFF_COLUMNS).eq("id", user.id).maybeSingle();
  if (!data || !data.is_active) return null;
  const real = { ...(data as StaffRow), email: user.email ?? null, viewingAs: null } satisfies CurrentStaff;

  if (real.role_id === "owner") {
    const viewAs = (await cookies()).get(VIEW_AS_COOKIE)?.value;
    if (viewAs && viewAs !== real.id) {
      const { data: other } = await createAdminClient().from("staff").select(STAFF_COLUMNS).eq("id", viewAs).maybeSingle();
      if (other) return { ...(other as StaffRow), email: null, viewingAs: { realId: real.id, realName: real.display_name } };
    }
  }
  return real;
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

import { Shell } from "@/components/Shell";
import type { NavItem } from "@/components/SidebarNav";
import { requireStaff } from "@/lib/auth";
import { can, ROLE_LABELS, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { IdleLock } from "./IdleLock";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const settings = await getSettings();
  const role = staff.role_id as RoleId;

  let photoUrl: string | null = null;
  if (staff.photo_path) {
    const supabase = await createClient();
    const { data } = await supabase.storage.from("staff-photos").createSignedUrl(staff.photo_path, 3600);
    photoUrl = data?.signedUrl ?? null;
  }

  const nav: NavItem[] = [
    { href: "/home", label: "Home", show: true },
    { href: "/customers", label: "Customers", show: can(role, "viewCustomers") },
    { href: "/vehicles", label: "Cars", show: can(role, "viewVehicles") },
    { href: "/team", label: "Team", show: can(role, "manageTeam") },
    { href: "/team/tablets", label: "Tablets", show: can(role, "viewTablets") && !can(role, "manageTeam") },
    { href: "/settings", label: "Settings", show: can(role, "manageSettings") },
    { href: "/audit", label: "Change log", show: can(role, "viewAudit") },
  ]
    .filter((n) => n.show)
    .map(({ href, label }) => ({ href, label }));

  return (
    <>
      {staff.login_type === "pin" ? <IdleLock seconds={Number(settings.tablet_idle_lock_seconds) || 120} /> : null}
      <Shell
        nav={nav}
        user={{ name: staff.display_name, role: ROLE_LABELS[role], photoUrl }}
        footer={
          <form method="post" action="/api/auth/signout">
            <button
              type="submit"
              className="min-h-10 px-4 rounded-control border border-white/30 text-white text-sm font-bold hover:bg-white/10 cursor-pointer md:w-full"
            >
              {staff.login_type === "pin" ? "Lock" : "Sign out"}
            </button>
          </form>
        }
      >
        {children}
      </Shell>
    </>
  );
}

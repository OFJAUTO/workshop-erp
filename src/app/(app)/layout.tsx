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
    { href: "/home", label: "Home", show: role !== "gate_in" && role !== "technician" },
    { href: "/dashboard", label: "Dashboard", show: can(role, "viewDashboard") },
    { href: "/calendar", label: "Calendar", show: can(role, "viewCalendar") },
    { href: "/assign", label: "To assign", show: can(role, "assignJobs") },
    { href: "/my-jobs", label: "My jobs", show: role === "technician" },
    { href: "/workshop", label: "Workshop list", show: role === "technician" },
    { href: "/road-tests", label: "Road tests", show: can(role, "roadTest") },
    { href: "/gate-in", label: "Gate in", show: can(role, "gateIn") },
    { href: "/jobs", label: "Jobs", show: can(role, "viewJobs") },
    { href: "/customers", label: "Customers", show: can(role, "viewCustomers") },
    { href: "/vehicles", label: "Cars", show: can(role, "viewVehicles") },
    { href: "/team", label: "Team", show: can(role, "manageTeam") },
    { href: "/team/tablets", label: "Tablets", show: can(role, "viewTablets") && !can(role, "manageTeam") },
    { href: "/settings", label: "Settings", show: can(role, "manageSettings") },
    { href: "/audit", label: "Change log", show: can(role, "viewAudit") },
    { href: "/overrides", label: "Overrides", show: can(role, "viewOverrides") },
  ]
    .filter((n) => n.show)
    .map(({ href, label }) => ({ href, label }));

  return (
    <>
      {staff.login_type === "pin" ? <IdleLock seconds={Number(settings.tablet_idle_lock_seconds) || 120} /> : null}
      <Shell
        nav={nav}
        user={{ id: staff.id, name: staff.display_name, role: ROLE_LABELS[role], photoUrl }}
        viewingAs={staff.viewingAs}
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

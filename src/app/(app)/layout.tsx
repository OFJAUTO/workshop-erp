import { Suspense } from "react";
import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import type { NavItem } from "@/components/SidebarNav";
import { getCurrentStaff, requireStaff } from "@/lib/auth";
import { can, ROLE_LABELS, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { FormGuard } from "@/components/FormGuard";
import { IdleLock } from "./IdleLock";
import { ModeGuard, type TabMode } from "./ModeGuard";
import { getCurrentDevice } from "@/lib/devices";

/** The browser tab says whose screens these are while the owner views or acts as someone. */
export async function generateMetadata(): Promise<Metadata> {
  const staff = await getCurrentStaff();
  if (staff?.viewingAs) return { title: `Viewing as ${staff.display_name} · OFJ Automotive · Workshop ERP` };
  if (staff?.actingAs) return { title: `Acting as ${staff.actingAs.forName} · OFJ Automotive · Workshop ERP` };
  return {};
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const settings = await getSettings();
  // A personal tablet stays logged in; a shared one locks after a few minutes idle.
  const device = await getCurrentDevice();
  const role = staff.role_id as RoleId;

  let photoUrl: string | null = null;
  if (staff.photo_path) {
    const supabase = await createClient();
    const { data } = await supabase.storage.from("staff-photos").createSignedUrl(staff.photo_path, 3600);
    photoUrl = data?.signedUrl ?? null;
  }

  // Parts see how much is waiting for them next to the menu entry: requests to price and approved parts to order.
  let partsPending = 0;
  if (role === "parts" || role === "owner") {
    const admin = createAdminClient();
    const [{ count: toPrice }, { count: toOrder }] = await Promise.all([
      admin.from("part_requests").select("id", { count: "exact", head: true }).eq("status", "open").eq("is_active", true),
      admin.from("part_items").select("id", { count: "exact", head: true }).eq("order_status", "to_order").eq("is_active", true),
    ]);
    partsPending = (toPrice ?? 0) + (toOrder ?? 0);
  }

  const entries: (NavItem & { show: boolean })[] = [
    { href: "/home", label: "Home", show: role !== "gate_in" && role !== "technician" && role !== "qc_inspector" },
    { href: "/dashboard", label: "Dashboard", show: can(role, "viewDashboard") },
    { href: "/calendar", label: "Calendar", show: can(role, "viewCalendar") && role !== "accounts" && role !== "parts" },
    { href: "/parts/arrivals", label: "Parts arrivals", show: role === "parts" || role === "owner" },
    { href: "/assign", label: "To assign", show: can(role, "assignJobs") },
    { href: "/bodyshop", label: "Bodyshop", show: can(role, "viewBodyshop") && role !== "accounts" && !(role === "workshop_manager" && staff.department_id === "mechanical") },
    { href: "/bodyshop/mine", label: "My section", show: role === "team_leader" },
    { href: "/my-jobs", label: "My jobs", show: role === "technician" },
    { href: "/road-tests", label: "Road tests", show: can(role, "roadTest") },
    { href: "/scans", label: "Scan reports", show: role === "owner" || role === "workshop_manager" || role === "qc_inspector" },
    { href: "/workshop", label: "Workshop list", show: role === "technician" || role === "qc_inspector" },
    { href: "/gate-in", label: "Gate in", show: can(role, "gateIn") },
    { href: "/jobs", label: "Jobs", show: can(role, "viewJobs") && role !== "accounts" },
    { href: "/parts", label: "Parts", show: can(role, "priceParts"), badge: role === "parts" ? partsPending : undefined },
    { href: "/parts/orders", label: "LPOs", show: can(role, "viewPurchaseOrders") && role !== "service_advisor" },
    { href: "/parts/stock", label: "Stock", show: can(role, "manageStock") },
    { href: "/parts/suppliers", label: "Suppliers", show: can(role, "manageSuppliers") },
    { href: "/qc", label: "Cars for QC", show: can(role, "doQc") },
    { href: "/wash", label: "Car wash", show: can(role, "washCars") },
    { href: "/workshop-load", label: "Workshop load", show: can(role, "manageWork") },
    { href: "/pauses", label: "Pause log", show: can(role, "manageWork") },
    { href: "/scoreboard", label: "Scoreboard", show: can(role, "manageWork") },
    { href: "/comebacks", label: "Comebacks", show: can(role, "manageWork") },
    { href: "/invoices", label: "Invoices and payments", show: can(role, "viewInvoices") },
    { href: "/recovery", label: "Recovery", show: role === "owner" || role === "service_advisor" || role === "accounts" },
    { href: "/profit", label: "Profit", show: can(role, "viewProfitList") },
    { href: "/reports/monthly", label: "Reports", show: role === "owner" },
    { href: "/reports/labour-rate", label: "Labour rate check", show: role === "accounts" },
    { href: "/attendance", label: "Attendance", show: can(role, "viewAttendance") },
    { href: "/estimates", label: "Estimates", show: can(role, "viewEstimates") },
    { href: "/customers", label: "Customers", show: can(role, "viewCustomers") },
    { href: "/vehicles", label: "Cars", show: can(role, "viewVehicles") && role !== "accounts" },
    { href: "/team", label: "Team", show: can(role, "manageTeam") },
    { href: "/team/tablets", label: "Tablets", show: can(role, "viewTablets") && !can(role, "manageTeam") },
    { href: "/settings", label: "Settings", show: can(role, "manageSettings") },
    { href: "/audit", label: "Change log", show: can(role, "viewAudit") },
    { href: "/overrides", label: "Overrides", show: can(role, "viewOverrides") },
  ];
  const nav: NavItem[] = entries.filter((n) => n.show).map(({ href, label, badge }) => ({ href, label, badge }));
  const tabMode: TabMode | null = staff.viewingAs ? { kind: "view", id: staff.id, name: staff.display_name } : staff.actingAs ? { kind: "act", id: staff.id, name: staff.actingAs.forName } : null;

  return (
    <>
      <Suspense fallback={null}><FormGuard /></Suspense>
      <Suspense fallback={null}><ModeGuard serverMode={tabMode} /></Suspense>
      <meta name="erp-known-words" content={((settings.known_words ?? []) as string[]).join("|")} />
      {staff.login_type === "pin" && !staff.actingAs && device?.kind !== "personal" ? <IdleLock seconds={Number(settings.tablet_idle_lock_seconds) || 120} /> : null}
      <Shell
        nav={nav}
        user={{ id: staff.id, name: staff.display_name, role: ROLE_LABELS[role], photoUrl }}
        sounds={{ tone: String(settings.notification_tone || "marimba"), ownerTone: String(settings.notification_tone_owner || "chord"), remindMinutes: Number(settings.notification_remind_minutes) || 2 }}
        viewingAs={staff.viewingAs}
        actingAs={staff.actingAs}
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

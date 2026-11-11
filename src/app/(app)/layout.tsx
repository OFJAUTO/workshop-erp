import { deviceDepartmentWords } from "@/lib/device-department";
import { approvalsCount } from "@/lib/approvals";
import { Suspense } from "react";
import { chargesReady } from "@/lib/charges";
import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import type { NavEntry, NavItem } from "@/components/SidebarNav";
import { getCurrentStaff, requireStaff } from "@/lib/auth";
import { can, ROLE_LABELS, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { FormGuard } from "@/components/FormGuard";
import { IdleLock } from "./IdleLock";
import { ModeGuard, type TabMode } from "./ModeGuard";
import { CustomerPanelHost } from "@/components/CustomerPanel";
import { RecordPaymentHost } from "@/components/RecordPaymentHost";
import { AuthAddedWindow } from "@/components/AuthCodeMissing";
import { SpellHost } from "@/components/SpellHost";
import { getCurrentDevice } from "@/lib/devices";
import { SENDS_ON_PRESS_FILTER, syncModeOf } from "@/lib/zoho-sync-rules";
import Link from "next/link";
import { passkeysReady } from "@/lib/passkey-server";

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

  // Pending charges (1 November 2026): the count next to the menu entry, never on the dashboard.
  let pendingCharges = 0;
  if (["owner", "service_advisor", "accounts"].includes(role) && (await chargesReady())) {
    const { count } = await createAdminClient().from("charge_entries").select("id", { count: "exact", head: true }).eq("status", "pending").eq("is_active", true);
    pendingCharges = count ?? 0;
  }

  // Zoho Books on manual (3 November 2026): how many documents a press of Sync to Zoho would send, next to the menu
  // entry (THE rule sendsOnPress: a row waiting for something else, such as its red bill, is never counted).
  let zohoWaiting = 0;
  if (can(role, "zohoSync") && syncModeOf(settings.zoho_sync_mode) === "manual") {
    const { count } = await createAdminClient().from("zoho_outbox").select("id", { count: "exact", head: true }).eq("status", "pending").or(SENDS_ON_PRESS_FILTER);
    zohoWaiting = count ?? 0;
  }

  // Mathew's Parts management group (5 November 2026): the one main item's badge sums what waits
  // inside - LPOs waiting for approval, and supplier invoices still to collect, enter or check
  // (to follow, or entered and not checked, or queried; counted per LPO, so a rare invoice split
  // over two LPOs counts twice here while the page groups it - the page is the truth).
  let lposPending = 0;
  let invoicesToCheck = 0;
  if (["owner", "accounts", "parts"].includes(role)) {
    const admin = createAdminClient();
    const [a, b, c] = await Promise.all([
      admin.from("purchase_orders").select("id", { count: "exact", head: true }).eq("status", "pending_approval").eq("is_active", true),
      admin.from("purchase_orders").select("id", { count: "exact", head: true }).eq("supplier_invoice_status", "to_follow").eq("is_active", true).neq("kind", "main").neq("status", "cancelled").neq("status", "pending_approval"),
      admin.from("purchase_orders").select("id", { count: "exact", head: true }).eq("supplier_invoice_status", "received").eq("is_active", true).neq("kind", "main").neq("status", "cancelled").neq("status", "pending_approval").or("supplier_invoice_checked_at.is.null,supplier_invoice_query.not.is.null"),
    ]);
    lposPending = a.count ?? 0;
    invoicesToCheck = (b.count ?? 0) + (c.count ?? 0);
  }
  const partsManagementItems: (NavItem & { show: boolean })[] = [
    { href: "/parts/orders", label: "LPOs", show: can(role, "viewPurchaseOrders") && role !== "service_advisor", badge: lposPending || undefined },
    { href: "/supplier-invoices", label: "Supplier invoices", show: ["owner", "accounts", "parts"].includes(role), badge: invoicesToCheck || undefined },
    { href: "/supplier-payments", label: "Supplier payments", show: can(role, "supplierPayments") },
    { href: "/parts-accounts", label: "Parts accounts", show: can(role, "viewPartsAccounts") },
    { href: "/parts/returns", label: "Purchase returns", show: ["owner", "accounts", "parts"].includes(role) },
    { href: "/parts/suppliers", label: "Suppliers", show: can(role, "manageSuppliers") },
    { href: "/parts/lathe", label: "Lathe", show: ["owner", "parts", "accounts", "workshop_manager"].includes(role) },
  ];
  const partsManagement = { group: "parts-management", label: "Parts management", items: partsManagementItems.filter((i) => i.show).map(({ href, label, badge }) => ({ href, label, badge })) };

  const pkReady = await passkeysReady();
  const tabletDevice = await getCurrentDevice().catch(() => null);
  // 11 November 2026 (Section 4): the owner's Approvals with its count.
  const approvalsWaiting = role === "owner" ? await approvalsCount().catch(() => 0) : 0;
  const entries: ((NavItem | typeof partsManagement) & { show: boolean })[] = [
    { href: "/home", label: "Home", show: role !== "gate_in" && role !== "technician" && role !== "qc_inspector" && role !== "team_leader" },
    { href: "/dashboard", label: "Dashboard", show: can(role, "viewDashboard") },
    { href: "/approvals", label: "Approvals", show: role === "owner", badge: approvalsWaiting || undefined },
    { href: "/calendar", label: "Calendar", show: can(role, "viewCalendar") && role !== "accounts" && role !== "parts" },
    { href: "/parts/arrivals", label: "Parts arrivals", show: role === "parts" || role === "owner" },
    { href: "/assign", label: "To assign", show: can(role, "assignJobs") },
    { href: "/bodyshop", label: "Bodyshop", show: can(role, "viewBodyshop") && role !== "accounts" && !(role === "workshop_manager" && staff.department_id === "mechanical") },
    { href: "/bodyshop/mine", label: "My team", show: role === "team_leader" },
    { href: "/my-jobs", label: "My jobs", show: role === "technician" },
    { href: "/road-tests", label: "Road tests", show: can(role, "roadTest") },
    { href: "/scans", label: "Scan reports", show: role === "owner" || role === "workshop_manager" || role === "qc_inspector" },
    { href: "/workshop", label: "Workshop list", show: role === "technician" || role === "qc_inspector" },
    { href: "/gate-in", label: "Gate in", show: can(role, "gateIn") },
    { href: "/jobs", label: "Jobs", show: can(role, "viewJobs") && role !== "accounts" },
    { href: "/parts", label: "Parts", show: can(role, "priceParts"), badge: role === "parts" ? partsPending : undefined },
    { ...partsManagement, show: partsManagement.items.length > 0 },
    { href: "/parts/stock", label: "Stock", show: can(role, "manageStock") },
    { href: "/qc", label: "Cars for QC", show: can(role, "doQc") },
    { href: "/wash", label: "Car wash", show: can(role, "washCars") },
    { href: "/workshop-load", label: "Workshop load", show: can(role, "manageWork") },
    { href: "/pauses", label: "Pause log", show: can(role, "manageWork") },
    { href: "/scoreboard", label: "Scoreboard", show: can(role, "manageWork") },
    { href: "/comebacks", label: "Comebacks", show: can(role, "manageWork") },
    { href: "/invoices", label: "Invoices and payments", show: can(role, "viewInvoices") },
    { href: "/pending-charges", label: "Pending charges", show: ["owner", "service_advisor", "accounts"].includes(role), badge: pendingCharges || undefined },
    { href: "/recovery", label: "Recovery", show: role === "owner" || role === "service_advisor" || role === "accounts" },
    { href: "/commissions", label: "Commissions", show: role === "owner" || role === "accounts" },
    { href: "/accounts-posting", label: "Accounts posting", show: can(role, "cardSettlements") },
    { href: "/zoho", label: "Zoho Books", show: can(role, "zohoSync"), badge: zohoWaiting || undefined },
    { href: "/warranties", label: "Warranties", show: role === "owner" || role === "service_advisor" },
    { href: "/profit", label: "Profit", show: role === "owner" },
    { href: "/reports/monthly", label: "Reports", show: role === "owner" },
    { href: "/reports/labour-rate", label: "Labour rate check", show: role === "accounts" },
    { href: "/attendance", label: "Attendance", show: can(role, "viewAttendance") },
    { href: "/estimates", label: "Estimates", show: can(role, "viewEstimates") },
    { href: "/quotes", label: "Quotations", show: can(role, "editQuotes") },
    { href: "/customers", label: "Customers", show: can(role, "viewCustomers") },
    { href: "/vehicles", label: "Cars", show: can(role, "viewVehicles") && role !== "accounts" },
    { href: "/team", label: "Team", show: can(role, "manageTeam") },
    { href: "/team/sign-ins", label: "Sign-ins", show: can(role, "manageTeam") && pkReady },
    { href: "/team/tablets", label: "Tablets", show: can(role, "viewTablets") && !can(role, "manageTeam") },
    { href: "/settings", label: "Settings", show: can(role, "manageSettings") },
    { href: "/audit", label: "Change log", show: can(role, "viewAudit") },
    { href: "/overrides", label: "Overrides", show: can(role, "viewOverrides") },
  ];
  const nav: NavEntry[] = entries.filter((n) => n.show).map((n) => ("group" in n ? { group: n.group, label: n.label, items: n.items } : { href: n.href, label: n.label, badge: n.badge }));
  const tabMode: TabMode | null = staff.viewingAs ? { kind: "view", id: staff.id, name: staff.display_name } : staff.actingAs ? { kind: "act", id: staff.id, name: staff.actingAs.forName } : null;

  return (
    <>
      <Suspense fallback={null}><FormGuard /></Suspense>
      <Suspense fallback={null}><ModeGuard serverMode={tabMode} /></Suspense>
      {can(role, "viewCustomers") ? <CustomerPanelHost /> : null}
      {/* 1 November 2026: THE Record payment window, for the people who record money (opened from any car, customer, job or search result). */}
      {can(role, "recordPayments") && !staff.viewingAs ? <Suspense fallback={null}><RecordPaymentHost /></Suspense> : null}
      {can(role, "recordPayments") && !staff.viewingAs ? <AuthAddedWindow /> : null}
      {can(role, "recordPayments") && !staff.viewingAs ? <meta name="erp-can-pay" content="1" /> : null}
      <meta name="erp-known-words" content={((settings.known_words ?? []) as string[]).join("|")} />
      {/* Who is signed in, for the send queue: a sending permit is only ever kept and used for this person. */}
      <meta name="erp-staff-id" content={staff.id} />
      {/* 1 November 2026: the spell check while typing (dotted underline, tap for suggestions), every word box. */}
      <SpellHost />
      {staff.login_type === "pin" && !staff.actingAs && device?.kind !== "personal" ? <IdleLock seconds={Number(settings.tablet_idle_lock_seconds) || 120} /> : null}
      <Shell
        tabletLabel={tabletDevice?.kind === "shared" && tabletDevice.department ? `${deviceDepartmentWords(tabletDevice.department)} tablet` : null}
        searchCustomers={can(role, "viewCustomers")}
        search={role !== "gate_in"}
        nav={nav}
        user={{ id: staff.id, name: staff.display_name, role: ROLE_LABELS[role], photoUrl }}
        sounds={{ tone: String(settings.notification_tone || "marimba"), ownerTone: String(settings.notification_tone_owner || "chord"), remindMinutes: Number(settings.notification_remind_minutes) || 2 }}
        viewingAs={staff.viewingAs}
        actingAs={staff.actingAs}
        footer={
          <div className="flex flex-col gap-2">
          {staff.login_type !== "pin" && pkReady ? (
            <Link href="/account/sign-in" className="min-h-10 px-4 rounded-control border border-white/30 text-on-dark text-sm font-bold hover:bg-white/10 flex items-center justify-center md:w-full" data-my-sign-in-link>
              My sign-in
            </Link>
          ) : null}
          <form method="post" action="/api/auth/signout">
            <button
              type="submit"
              className="min-h-10 px-4 rounded-control border border-white/30 text-on-dark text-sm font-bold hover:bg-white/10 cursor-pointer md:w-full"
            >
              {staff.login_type === "pin" ? "Lock" : "Sign out"}
            </button>
          </form>
          </div>
        }
      >
        {children}
      </Shell>
    </>
  );
}

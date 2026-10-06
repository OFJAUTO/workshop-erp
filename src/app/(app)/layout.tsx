import Link from "next/link";
import { Avatar } from "@/components/ui";
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

  const nav: { href: string; label: string; show: boolean }[] = [
    { href: "/home", label: "Home", show: true },
    { href: "/customers", label: "Customers", show: can(role, "viewCustomers") },
    { href: "/vehicles", label: "Cars", show: can(role, "viewVehicles") },
    { href: "/team", label: "Team", show: can(role, "manageTeam") },
    { href: "/team/tablets", label: "Tablets", show: can(role, "viewTablets") && !can(role, "manageTeam") },
    { href: "/settings", label: "Settings", show: can(role, "manageSettings") },
    { href: "/audit", label: "Change log", show: can(role, "viewAudit") },
  ];

  return (
    <div className="min-h-full flex flex-col">
      {staff.login_type === "pin" ? <IdleLock seconds={Number(settings.tablet_idle_lock_seconds) || 120} /> : null}
      <header className="bg-canvas">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <Link
              href="/home"
              className="inline-flex h-11 items-center rounded-control border border-dashed border-faint px-4 text-xs font-semibold tracking-[0.12em] text-muted"
            >
              {settings.company_name}
            </Link>
            <nav className="flex flex-wrap gap-1 text-sm font-medium">
              {nav
                .filter((n) => n.show)
                .map((n) => (
                  <Link key={n.href} href={n.href} className="px-3.5 py-3 rounded-control hover:bg-chip">
                    {n.label}
                  </Link>
                ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2.5">
              <Avatar name={staff.full_name} photoUrl={photoUrl} size={36} />
              <span className="flex flex-col leading-tight">
                <span className="text-sm font-semibold">{staff.display_name}</span>
                <span className="text-xs text-muted">{ROLE_LABELS[role]}</span>
              </span>
            </div>
            <form method="post" action="/api/auth/signout">
              <button
                type="submit"
                className="min-h-11 px-4 rounded-control border border-line-strong bg-white text-sm font-bold hover:bg-canvas cursor-pointer"
              >
                {staff.login_type === "pin" ? "Lock" : "Sign out"}
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 pb-10 flex flex-col gap-6">{children}</div>
      </main>
    </div>
  );
}

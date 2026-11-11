import { deviceDepartmentWords, onTabletDepartment } from "@/lib/device-department";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PublicShell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { getCurrentDevice } from "@/lib/devices";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPARTMENT_LABELS, type DepartmentId } from "@/lib/roles";
import { PinLogin, type TabletPerson } from "./PinLogin";
import { passkeyPerson } from "@/lib/passkey-rules";
import { passkeyCounts, passkeyRollout, passkeyRp, passkeysReady } from "@/lib/passkey-server";

export const dynamic = "force-dynamic";

export default async function TabletPage() {
  const device = await getCurrentDevice();
  // A bodyshop section tablet has its own screen: the section's cars and PIN clocking.
  if (device?.section) redirect("/tablet/bodyshop");

  if (!device) {
    return (
      <PublicShell note="Shared tablet">
        <div className="flex-1 flex items-center justify-center p-6">
          <Card className="max-w-md w-full flex flex-col gap-3">
            <h1 className="text-xl font-extrabold">This tablet is not registered</h1>
            <p className="text-sm text-muted">
              PIN login only works on tablets the owner has registered. To register this one, the owner signs in
              here with their own email and password, then opens the registration page.
            </p>
            <Link href="/login?next=/tablet/register" className="font-semibold underline underline-offset-4">
              Owner: sign in to register this tablet
            </Link>
          </Card>
        </div>
      </PublicShell>
    );
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("staff")
    .select("id, display_name, full_name, role_id, team, department_id, photo_path")
    .eq("is_active", true)
    .in("login_type", ["pin", "both"])
    .order("department_id")
    .order("display_name");

  const paths = (rows ?? []).map((r) => r.photo_path).filter((p): p is string => !!p);
  const signed = paths.length
    ? await admin.storage.from("staff-photos").createSignedUrls(paths, 3600)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlByPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));

  const scoped = device.kind === "personal" ? (rows ?? []).filter((r) => r.id === device.staff_id) : (rows ?? []);
  // A red dot on a photo: that person has something waiting.
  const { data: unreadRows } = await admin.from("notifications").select("staff_id").is("read_at", null).in("staff_id", scoped.map((r) => r.id));
  const unread = new Set((unreadRows ?? []).map((n) => n.staff_id as string));
  // Passkey users with a phone set up sign in with it here too (their PIN no longer opens the ERP).
  const pkOn = !!passkeyRp() && (await passkeysReady());
  const rollout = pkOn ? await passkeyRollout() : "owner";
  const phones = pkOn ? await passkeyCounts(scoped.filter((r) => passkeyPerson(r, rollout)).map((r) => r.id)).catch(() => new Map<string, number>()) : new Map<string, number>();
  // 11 November 2026 (Section 8): who is clocked in (an open work session or bodyshop clocking) comes first.
  const ids = scoped.map((r) => r.id);
  const [{ data: ws }, { data: bc }] = await Promise.all([
    ids.length ? admin.from("work_sessions").select("technician_id").in("technician_id", ids).is("ended_at", null) : Promise.resolve({ data: [] }),
    ids.length ? admin.from("bodyshop_clockings").select("staff_id").in("staff_id", ids).is("ended_at", null) : Promise.resolve({ data: [] }),
  ]);
  const clocked = new Set([...((ws ?? []) as { technician_id: string }[]).map((x) => x.technician_id), ...((bc ?? []) as { staff_id: string }[]).map((x) => x.staff_id)]);
  const people: TabletPerson[] = scoped.map((r) => ({
    clockedIn: clocked.has(r.id),
    mine: onTabletDepartment(device.department ?? null, r.department_id as string | null),
    unread: unread.has(r.id),
    passkey: (phones.get(r.id) ?? 0) > 0,
    id: r.id,
    display_name: r.display_name,
    full_name: r.full_name,
    department: r.department_id ? DEPARTMENT_LABELS[r.department_id as DepartmentId] : null,
    photoUrl: r.photo_path ? (urlByPath.get(r.photo_path) ?? null) : null,
  }));

  return (
    <PublicShell note={device.name}>
      <div className="flex-1 flex flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="text-2xl font-extrabold">{device.kind === "personal" ? "Enter your PIN" : "Tap your name"}</h1>
          {device.kind === "shared" ? <span className="rounded-full border border-line-strong px-2.5 py-0.5 text-xs font-bold uppercase tracking-[0.06em]" data-tablet-department={device.department ?? "none"}>Department: {deviceDepartmentWords(device.department)}</span> : null}
        </div>
        <PinLogin people={[...people].sort((a, b) => Number(b.clockedIn) - Number(a.clockedIn))} autoSelect={device.kind === "personal"} departmentLabel={device.kind === "shared" && device.department && device.department !== "both" ? deviceDepartmentWords(device.department) : null} />
      </div>
    </PublicShell>
  );
}

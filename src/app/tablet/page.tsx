import Link from "next/link";
import { Card } from "@/components/ui";
import { getCurrentDevice } from "@/lib/devices";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSettings } from "@/lib/settings";
import { DEPARTMENT_LABELS, type DepartmentId } from "@/lib/roles";
import { PinLogin, type TabletPerson } from "./PinLogin";

export const dynamic = "force-dynamic";

export default async function TabletPage() {
  const device = await getCurrentDevice();
  const settings = await getSettings();

  if (!device) {
    return (
      <main className="flex-1 flex items-center justify-center p-6">
        <Card className="max-w-md w-full flex flex-col gap-3">
          <h1 className="text-xl font-bold">This tablet is not registered</h1>
          <p className="text-sm text-muted">
            PIN login only works on tablets the owner has registered. To register this one, the owner
            signs in here with their own email and password, then opens the registration page.
          </p>
          <Link href="/login?next=/tablet/register" className="font-semibold underline underline-offset-4">
            Owner: sign in to register this tablet
          </Link>
        </Card>
      </main>
    );
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("staff")
    .select("id, display_name, full_name, department_id, photo_path")
    .eq("is_active", true)
    .eq("login_type", "pin")
    .order("department_id")
    .order("display_name");

  const paths = (rows ?? []).map((r) => r.photo_path).filter((p): p is string => !!p);
  const signed = paths.length
    ? await admin.storage.from("staff-photos").createSignedUrls(paths, 3600)
    : { data: [] as { path: string | null; signedUrl: string }[] };
  const urlByPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));

  const people: TabletPerson[] = (rows ?? []).map((r) => ({
    id: r.id,
    display_name: r.display_name,
    full_name: r.full_name,
    department: r.department_id ? DEPARTMENT_LABELS[r.department_id as DepartmentId] : null,
    photoUrl: r.photo_path ? (urlByPath.get(r.photo_path) ?? null) : null,
  }));

  return (
    <main className="flex-1 flex flex-col gap-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <span className="inline-flex h-11 items-center rounded-control border border-dashed border-faint px-4 text-xs font-semibold tracking-[0.12em] text-muted">
            {settings.company_name}
          </span>
          <span className="text-sm text-muted">{device.name}</span>
        </div>
        <span className="text-sm font-semibold">Tap your name</span>
      </header>
      <PinLogin people={people} />
    </main>
  );
}

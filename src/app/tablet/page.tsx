import Link from "next/link";
import { PublicShell } from "@/components/Shell";
import { Card } from "@/components/ui";
import { getCurrentDevice } from "@/lib/devices";
import { createAdminClient } from "@/lib/supabase/admin";
import { DEPARTMENT_LABELS, type DepartmentId } from "@/lib/roles";
import { PinLogin, type TabletPerson } from "./PinLogin";

export const dynamic = "force-dynamic";

export default async function TabletPage() {
  const device = await getCurrentDevice();

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
    <PublicShell note={device.name}>
      <div className="flex-1 flex flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-extrabold">Tap your name</h1>
        <PinLogin people={people} />
      </div>
    </PublicShell>
  );
}

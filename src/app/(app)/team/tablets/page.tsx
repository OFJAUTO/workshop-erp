import { Badge, Button, Card, Empty, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { can, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { DeviceRow } from "@/lib/types";
import { setDeviceActive } from "../actions";

const LOCATION_LABEL = { workshop: "Workshop", bodyshop: "Bodyshop", office: "Office" } as const;

export default async function TabletsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const staff = await requirePermission("viewTablets");
  const { error } = await searchParams;
  const canManage = can(staff.role_id as RoleId, "manageTablets");

  const supabase = await createClient();
  const { data } = await supabase
    .from("devices")
    .select("id, name, location, is_active, registered_at, registered_by, last_seen_at, last_staff_id, last_user:staff!devices_last_staff_id_fkey(display_name)")
    .order("is_active", { ascending: false })
    .order("location")
    .order("name");
  const devices = (data ?? []) as unknown as (DeviceRow & { last_user: { display_name: string } | null })[];

  return (
    <>
      <PageHeader title="Registered tablets" subtitle="PIN login only works on these devices." />
      {error ? <Notice tone="error">{error}</Notice> : null}

      {canManage ? (
        <Card className="flex flex-col gap-2">
          <p className="font-semibold">To register a new tablet</p>
          <ol className="list-decimal pl-5 text-sm text-muted flex flex-col gap-1">
            <li>On the tablet, open the app address in Chrome and sign in with your owner email and password.</li>
            <li>
              Open <span className="font-semibold text-ink">/tablet/register</span>, give the tablet a name and tap Register.
            </li>
            <li>You are signed out and the tablet shows the name-and-PIN screen. Add it to the home screen for full-screen use.</li>
          </ol>
        </Card>
      ) : null}

      {devices.length === 0 ? (
        <Empty title="No tablets registered yet" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {devices.map((d) => (
            <Card key={d.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-col">
                  <span className="font-bold">{d.name}</span>
                  <span className="text-xs text-muted">{LOCATION_LABEL[d.location]}</span>
                </span>
                {d.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Removed</Badge>}
              </div>
              <dl className="text-xs text-muted flex flex-col gap-0.5">
                <div>Registered {formatDateTime(d.registered_at)}</div>
                <div>
                  Last login {d.last_seen_at ? formatDateTime(d.last_seen_at) : "never"}
                  {d.last_user?.display_name ? ` · ${d.last_user.display_name}` : ""}
                </div>
              </dl>
              {canManage ? (
                <form action={setDeviceActive.bind(null, d.id, !d.is_active)}>
                  <Button type="submit" tone={d.is_active ? "danger" : "secondary"} size="md">
                    {d.is_active ? "Remove this tablet" : "Re-activate"}
                  </Button>
                </form>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

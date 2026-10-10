import { Badge, Button, Card, Empty, Notice, PageHeader } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { can, type RoleId } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import type { DeviceRow } from "@/lib/types";
import { blockDevice, removeDevice, setDeviceKind } from "../actions";
import { Select } from "@/components/ui";

const LOCATION_LABEL = { workshop: "Workshop", bodyshop: "Bodyshop", office: "Office", personal: "Personal" } as const;

export default async function TabletsPage({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const staff = await requirePermission("viewTablets");
  const { error, message } = await searchParams;
  const canManage = can(staff.role_id as RoleId, "manageTablets");
  const { data: techRows } = await (await createClient()).from("staff").select("id, display_name").eq("role_id", "technician").eq("is_active", true).order("display_name");
  const technicians = (techRows ?? []) as { id: string; display_name: string }[];

  const supabase = await createClient();
  const { data } = await supabase
    .from("devices")
    .select("id, name, location, kind, staff_id, is_active, registered_at, registered_by, last_seen_at, last_staff_id, owner:staff!devices_staff_id_fkey(display_name), last_user:staff!devices_last_staff_id_fkey(display_name)")
    .order("is_active", { ascending: false })
    .order("kind")
    .order("name");
  const devices = (data ?? []) as unknown as (DeviceRow & { owner: { display_name: string } | null; last_user: { display_name: string } | null })[];
  const active = devices.filter((d) => d.is_active);
  const removed = devices.filter((d) => !d.is_active);

  return (
    <>
      <PageHeader title="Registered devices" subtitle="PIN login only works on these. An unregistered phone or tablet cannot use PIN login at all." />
      {error ? <Notice tone="error">{error}</Notice> : null}
      {message ? <Notice tone="success">{message}</Notice> : null}

      {canManage ? (
        <Card className="flex flex-col gap-2">
          <p className="font-semibold">To register a device (owner only)</p>
          <ol className="list-decimal pl-5 text-sm text-muted flex flex-col gap-1">
            <li>On the phone or tablet itself, open erp.ofjauto.com in Chrome and sign in with your owner email and password.</li>
            <li>
              Open <span className="font-semibold text-ink">erp.ofjauto.com/tablet/register</span>. Choose <strong>Shared</strong> (name grid for everyone with handheld login) or <strong>Personal</strong> (assigned to one person, opens straight to their PIN).
            </li>
            <li>Tap Register. You are signed out and the device shows its PIN screen. Add it to the home screen for full-screen use.</li>
          </ol>
        </Card>
      ) : null}

      {active.length === 0 ? (
        <Empty title="No devices registered yet" />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {active.map((d) => (
            <Card key={d.id} className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <span className="flex flex-col">
                  <span className="font-bold">{d.name}</span>
                  <span className="text-xs text-muted">
                    {d.kind === "personal" ? `Personal · ${d.owner?.display_name ?? "unassigned"}` : `Shared · ${LOCATION_LABEL[d.location]}`}
                  </span>
                </span>
                <Badge tone={d.kind === "personal" ? "outline" : "neutral"}>{d.kind === "personal" ? "Personal" : "Shared"}</Badge>
              </div>
              <dl className="text-xs text-muted flex flex-col gap-0.5">
                <div>Registered {formatDateTime(d.registered_at)}</div>
                <div>
                  Last login {d.last_seen_at ? formatDateTime(d.last_seen_at) : "never"}
                  {d.last_user?.display_name ? ` · ${d.last_user.display_name}` : ""}
                </div>
              </dl>
              {canManage ? (
                <div className="flex flex-col gap-2 border-t border-line pt-2">
                  <form action={setDeviceKind.bind(null, d.id)} className="flex flex-wrap items-center gap-2">
                    {d.kind === "personal" ? (
                      <><input type="hidden" name="kind" value="shared" /><Button type="submit" tone="secondary" size="md">Switch to shared</Button></>
                    ) : (
                      <><input type="hidden" name="kind" value="personal" /><Select name="staff_id" defaultValue="" required className="w-44"><option value="" disabled>Technician…</option>{technicians.map((t) => <option key={t.id} value={t.id}>{t.display_name}</option>)}</Select><Button type="submit" tone="secondary" size="md">Make personal</Button></>
                    )}
                  </form>
                  <div className="flex flex-wrap gap-2">
                    <form action={blockDevice.bind(null, d.id)}><Button type="submit" tone="danger" size="md">Block this device</Button></form>
                    <form action={removeDevice.bind(null, d.id)}><Button type="submit" tone="ghost" size="md">Remove</Button></form>
                  </div>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      {removed.length ? (
        <details className="text-sm text-muted">
          <summary className="cursor-pointer font-semibold">Removed devices ({removed.length})</summary>
          <ul className="mt-2 flex flex-col gap-1">
            {removed.map((d) => (
              <li key={d.id}>
                {d.name} · {d.kind} · registered {formatDateTime(d.registered_at)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}

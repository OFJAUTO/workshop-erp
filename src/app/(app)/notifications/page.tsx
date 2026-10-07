import Link from "next/link";
import { Badge, Button, Card, Empty, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { NOTIFICATION_TYPES } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/server";
import type { NotificationRow } from "@/lib/types";
import { savePreferences } from "./actions";

export default async function NotificationsPage() {
  const staff = await requireStaff();
  const supabase = await createClient();
  const [{ data: items }, { data: prefs }] = await Promise.all([
    supabase
      .from("notifications")
      .select("id, staff_id, type, title, body, job_id, href, read_at, created_at")
      .eq("staff_id", staff.id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("notification_preferences").select("type, enabled").eq("staff_id", staff.id),
  ]);
  const off = new Set((prefs ?? []).filter((p) => !p.enabled).map((p) => p.type));
  const rows = (items ?? []) as NotificationRow[];

  return (
    <>
      <PageHeader title="Notifications" subtitle="What you get told about, and everything received so far." />
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="flex flex-col gap-4">
          <SectionLabel>What to receive</SectionLabel>
          <form action={savePreferences} className="flex flex-col gap-3">
            {NOTIFICATION_TYPES.map((t) => (
              <label key={t.type} className={`flex items-center gap-3 min-h-11 ${t.locked ? "opacity-70" : "cursor-pointer"}`}>
                <input type="checkbox" name={`pref__${t.type}`} defaultChecked={!off.has(t.type)} disabled={t.locked} className="h-5 w-5 accent-ink" />
                <span className="text-sm font-semibold">{t.label}</span>
                {t.locked ? <Badge>Always on</Badge> : null}
              </label>
            ))}
            <Button type="submit" tone="secondary">
              Save
            </Button>
            <p className="text-xs text-muted">Approvals cannot be switched off. Sound for background tabs is set from the bell menu.</p>
          </form>
        </Card>

        <div className="xl:col-span-2 flex flex-col gap-3">
          <SectionLabel right={`${rows.length}`}>Received</SectionLabel>
          {rows.length === 0 ? (
            <Empty title="Nothing yet" />
          ) : (
            <Card className="p-0 overflow-hidden">
              <ul className="divide-y divide-line">
                {rows.map((n) => (
                  <li key={n.id} className={n.read_at ? "" : "bg-chip/50"}>
                    <Link href={n.href ?? (n.job_id ? `/jobs/${n.job_id}` : "#")} className="flex flex-col gap-0.5 px-5 py-3 hover:bg-canvas">
                      <span className="text-sm font-semibold">{n.title}</span>
                      {n.body ? <span className="text-xs text-muted">{n.body}</span> : null}
                      <span className="text-[11px] text-faint">{formatDateTime(n.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

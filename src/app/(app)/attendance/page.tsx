import { Badge, Card, Empty, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { SHIFT_SELECT, type ShiftRow } from "@/lib/work-data";

export const dynamic = "force-dynamic";

const daysAgoDate = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

/** Shift report: who clocked in and out, on time or late against the opening hour, for the last two weeks. */
export default async function AttendancePage() {
  await requirePermission("viewAttendance");
  const settings = await getSettings();
  const admin = createAdminClient();
  const since = daysAgoDate(14);
  const [{ data: shifts }, { data: staff }] = await Promise.all([
    admin.from("shifts").select(SHIFT_SELECT).gte("shift_date", since).eq("is_active", true).order("clock_in", { ascending: false }),
    admin.from("staff").select("id, display_name, role_id").eq("is_active", true),
  ]);
  const rows = (shifts ?? []) as ShiftRow[];
  const nameOf = new Map((staff ?? []).map((s) => [s.id, s.display_name]));
  const byDate = new Map<string, ShiftRow[]>();
  for (const r of rows) byDate.set(r.shift_date, [...(byDate.get(r.shift_date) ?? []), r]);
  const hours = (r: ShiftRow) => (r.clock_out ? Math.round((Date.parse(r.clock_out) - Date.parse(r.clock_in)) / 60000) : null);
  const summary = new Map<string, { days: number; late: number; lateMinutes: number }>();
  for (const r of rows) {
    const s = summary.get(r.staff_id) ?? { days: 0, late: 0, lateMinutes: 0 };
    s.days++;
    if (r.late_minutes > 0) {
      s.late++;
      s.lateMinutes += r.late_minutes;
    }
    summary.set(r.staff_id, s);
  }
  return (
    <>
      <PageHeader title="Attendance" subtitle={`Shift clock, last 14 days. Opening hour ${settings.opening_hour}:00; anything after counts as late.`} />
      {rows.length === 0 ? <Empty title="No shifts recorded yet" /> : null}
      {summary.size ? (
        <Card className="flex flex-col gap-2">
          <SectionLabel>On time and late</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {Array.from(summary.entries()).sort((a, b) => b[1].late - a[1].late).map(([id, s]) => (
              <li key={id} className="py-2 flex flex-wrap items-center gap-3">
                <span className="font-semibold w-44">{nameOf.get(id) ?? "Staff"}</span>
                <span>{s.days} day{s.days === 1 ? "" : "s"}</span>
                <Badge tone={s.late ? "red" : "green"}>{s.late ? `${s.late} late, ${s.lateMinutes} min in all` : "Always on time"}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {Array.from(byDate.entries()).map(([date, list]) => (
        <Card key={date} className="flex flex-col gap-2">
          <SectionLabel right={`${list.length}`}>{date}</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {list.map((r) => (
              <li key={r.id} className="py-1.5 flex flex-wrap items-center gap-3">
                <span className="font-semibold w-44">{nameOf.get(r.staff_id) ?? "Staff"}</span>
                <span>in {formatDateTime(r.clock_in)}</span>
                <span>{r.clock_out ? `out ${formatDateTime(r.clock_out)}` : "still in"}</span>
                {hours(r) !== null ? <span className="text-muted">{Math.floor(hours(r)! / 60)} h {hours(r)! % 60} min</span> : null}
                <Badge tone={r.late_minutes ? "red" : "green"}>{r.late_minutes ? `${r.late_minutes} min late` : "On time"}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}

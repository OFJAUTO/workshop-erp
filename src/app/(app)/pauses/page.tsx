import Link from "next/link";
import { Badge, Button, Card, Empty, Input, PageHeader, SectionLabel, Notice } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { dubaiDate } from "@/lib/jobs";
import { createAdminClient } from "@/lib/supabase/admin";
import { formatPlate } from "@/lib/types";
import { decidePause } from "../jobs/work-actions";

export const dynamic = "force-dynamic";

const fmt = (min: number) => `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, "0")} min`;
type Row = { id: string; job_id: string; technician_id: string; reason: string; started_at: string; ended_at: string | null; minutes: number | string | null; accepted: boolean; technician: { display_name: string } | null; job: { job_number: string; vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null } | null } | null };

/** The pause log: one day, every technician, every pause with its reason and length, totals, and "Not accepted". Owner and managers. */
export default async function PausesPage({ searchParams }: { searchParams: Promise<{ date?: string; message?: string; error?: string }> }) {
  await requirePermission("manageWork");
  const sp = await searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : dubaiDate();
  const from = new Date(`${date}T00:00:00+04:00`).toISOString();
  const to = new Date(new Date(`${date}T00:00:00+04:00`).getTime() + 86400000).toISOString();
  const { data } = await createAdminClient().from("work_pauses").select("id, job_id, technician_id, reason, started_at, ended_at, minutes, accepted, technician:staff!work_pauses_technician_id_fkey(display_name), job:jobs(job_number, vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin))").eq("is_active", true).gte("started_at", from).lt("started_at", to).order("started_at");
  const rows = (data ?? []) as unknown as Row[];
  // eslint-disable-next-line react-hooks/purity -- a server page: rendered once per request, the clock is read once
  const nowMs = Date.now();
  const minutesOf = (p: Row) => (p.minutes !== null ? Number(p.minutes) : p.ended_at ? 0 : Math.round((nowMs - Date.parse(p.started_at)) / 60000));
  const byTech = new Map<string, Row[]>();
  for (const r of rows) byTech.set(r.technician_id, [...(byTech.get(r.technician_id) ?? []), r]);
  const shift = (days: number) => {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return (
    <>
      <PageHeader title="Pause log" subtitle={`${rows.length} pause${rows.length === 1 ? "" : "s"} on ${date} · ${fmt(rows.reduce((a, r) => a + minutesOf(r), 0))} in total`} actions={<form className="flex items-center gap-2"><Link href={`/pauses?date=${shift(-1)}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold">Previous day</Link><Input type="date" name="date" defaultValue={date} className="w-44" /><Button type="submit" tone="secondary" size="md">Show</Button><Link href={`/pauses?date=${shift(1)}`} className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-white px-3 text-sm font-bold">Next day</Link></form>} />
      {sp.message ? <Notice tone="success">{sp.message}</Notice> : null}
      {sp.error ? <Notice tone="error">{sp.error}</Notice> : null}
      {rows.length === 0 ? <Empty title="No pauses on this day" /> : null}
      {Array.from(byTech.entries()).map(([tid, list]) => (
        <Card key={tid} className="flex flex-col gap-2">
          <SectionLabel right={`${list.length} · ${fmt(list.reduce((a, r) => a + minutesOf(r), 0))}${list.some((r) => r.accepted === false) ? ` · ${list.filter((r) => r.accepted === false).length} not accepted` : ""}`}>{list[0].technician?.display_name ?? "Technician"}</SectionLabel>
          <ul className="divide-y divide-line text-sm">
            {list.map((p) => (
              <li key={p.id} className={`py-2 flex flex-wrap items-center gap-3 ${p.accepted === false ? "text-red" : ""}`}>
                <span className="text-muted w-14">{formatDateTime(p.started_at).slice(-5)}</span>
                <Link href={`/jobs/${p.job_id}/work`} className="font-semibold underline underline-offset-4">{p.job?.vehicle ? formatPlate(p.job.vehicle) : p.job?.job_number}</Link>
                <span>{p.reason}</span>
                <span className="text-muted">{p.ended_at ? fmt(minutesOf(p)) : "still paused"}</span>
                {p.accepted === false ? <Badge tone="red">Not accepted</Badge> : null}
                <form action={decidePause.bind(null, p.id)} className="ml-auto">
                  <input type="hidden" name="return_to" value={`/pauses?date=${date}`} />
                  {p.accepted === false ? <Button type="submit" name="accepted" value="yes" tone="ghost" size="md">Accept after all</Button> : <Button type="submit" name="accepted" value="no" tone="ghost" size="md">Not accepted</Button>}
                </form>
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </>
  );
}

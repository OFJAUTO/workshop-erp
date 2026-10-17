import { Button, Card, Input, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { sideOfDepartment } from "@/lib/inspection";
import { getSettings } from "@/lib/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveLabourActuals, useLabourRate } from "../labour-rate-actions";

export const dynamic = "force-dynamic";

/**
 * The monthly labour rate check. The cost rate is the technicians' all-in cost only (salaries, allowances,
 * accommodation, transport, visas and insurance, leave and tickets, gratuity) divided by the hours actually clocked
 * on cars; everything else belongs in Monthly fixed costs. Accounts type the month's cost per side; the owner sees
 * the real rate next to the one in Settings and takes it over with one tap.
 */
export default async function LabourRatePage({ searchParams }: { searchParams: Promise<{ month?: string; message?: string; error?: string }> }) {
  const staff = await requireStaff();
  if (!["owner", "accounts"].includes(staff.role_id)) return <Notice tone="error">The labour rate check is for the owner and accounts.</Notice>;
  const isOwner = staff.role_id === "owner" && !staff.viewingAs;
  const { month: monthParam, message, error } = await searchParams;
  // eslint-disable-next-line react-hooks/purity -- a server page: the month is read once per request
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 7);
  const admin = createAdminClient();
  const settings = await getSettings();
  const from = `${month}-01T00:00:00+04:00`;
  const toMonth = month.slice(5) === "12" ? `${Number(month.slice(0, 4)) + 1}-01` : `${month.slice(0, 4)}-${String(Number(month.slice(5)) + 1).padStart(2, "0")}`;
  const to = `${toMonth}-01T00:00:00+04:00`;
  const [{ data: sessions }, { data: clockings }] = await Promise.all([
    admin.from("work_sessions").select("minutes, started_at, ended_at, job:jobs!inner(department)").eq("is_active", true).gte("started_at", new Date(from).toISOString()).lt("started_at", new Date(to).toISOString()),
    admin.from("bodyshop_clockings").select("minutes").eq("is_active", true).gte("started_at", new Date(from).toISOString()).lt("started_at", new Date(to).toISOString()),
  ]);
  const minutesOf = { mechanical: 0, bodyshop: 0 };
  for (const s of (sessions ?? []) as unknown as { minutes: number | null; started_at: string; ended_at: string | null; job: { department: string | null } }[]) {
    const side = sideOfDepartment(s.job?.department) ?? "mechanical";
    minutesOf[side] += s.minutes ?? (s.ended_at ? Math.round((Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60000) : 0);
  }
  for (const c of (clockings ?? []) as { minutes: number | null }[]) minutesOf.bodyshop += Number(c.minutes) || 0;
  const actuals = ((settings.labour_cost_actuals ?? {}) as Record<string, Record<string, number>>)[month] ?? {};
  const byDept = (settings.technician_cost_rate_by_department ?? {}) as Record<string, number>;
  const base = Number(settings.technician_cost_rate_aed) || 0;
  const sides: ("mechanical" | "bodyshop")[] = ["mechanical", "bodyshop"];
  const fmt = (n: number) => `AED ${Math.round(n).toLocaleString("en-GB")}`;

  return (
    <>
      <PageHeader title="Labour rate check" subtitle="Technicians' all-in cost for the month ÷ hours clocked on cars = the real hourly rate, next to the one in Settings." />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Card className="flex flex-col gap-3">
        <SectionLabel>Month</SectionLabel>
        <form className="flex flex-wrap items-end gap-2">
          <Input type="month" name="month" defaultValue={month} className="w-44" />
          <Button type="submit" tone="secondary" size="md">Show</Button>
        </form>
        <p className="text-xs text-muted">The all-in cost is salaries, allowances, accommodation, transport, visas and insurance, leave and tickets, and gratuity for the technicians only. Rent, office and management staff, DEWA, insurance and software belong in Monthly fixed costs (Settings), never in this rate.</p>
      </Card>
      <form action={saveLabourActuals.bind(null, month)} className="grid grid-cols-1 lg:grid-cols-2 gap-6" data-labour-rate-check>
        {sides.map((side) => {
          const hours = minutesOf[side] / 60;
          const cost = Number(actuals[side]) || 0;
          const real = hours > 0 && cost > 0 ? cost / hours : null;
          const current = Number(byDept[side]) || base;
          return (
            <Card key={side} className="flex flex-col gap-3" data-rate-side={side}>
              <SectionLabel right={`${hours.toFixed(1)} h clocked`}>{side === "mechanical" ? "Mechanical" : "Bodyshop"}</SectionLabel>
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Technicians&apos; all-in cost for {month} (AED, typed by accounts)
                <Input name={side} defaultValue={cost ? String(cost) : ""} inputMode="numeric" placeholder="0" className="w-48" data-rate-cost />
              </label>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted">Hours clocked on cars</dt><dd className="text-right font-semibold">{hours.toFixed(1)} h</dd>
                <dt className="text-muted">Real rate (cost ÷ hours)</dt><dd className="text-right font-extrabold" data-real-rate>{real === null ? "—" : `${fmt(real)}/h`}</dd>
                <dt className="text-muted">Rate in Settings now</dt><dd className="text-right" data-current-rate>{fmt(current)}/h</dd>
              </dl>
              {isOwner && real !== null ? (
                <Button type="submit" size="md" formAction={useLabourRate.bind(null, side, month, Math.round(real))} data-use-rate>Use this rate ({fmt(Math.round(real))}/h)</Button>
              ) : null}
            </Card>
          );
        })}
        <div className="lg:col-span-2"><Button type="submit" tone="secondary" size="md" data-save-actuals>Save the costs</Button></div>
      </form>
    </>
  );
}

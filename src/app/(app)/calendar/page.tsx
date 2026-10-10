import Link from "next/link";
import { BookingIcon } from "@/components/BookingIcons";
import { LiveRefresh } from "@/components/LiveRefresh";
import { Badge, Button, Card, Input, LinkButton, PageHeader, SectionLabel } from "@/components/ui";
import { requirePermission } from "@/lib/auth";
import {
  BOOKING_KIND_SHORT,
  addDays,
  colourFor,
  dayStartIso,
  dubaiDateOf,
  dubaiTimeOf,
  fillTemplate,
  formatDayHeading,
  formatMonthHeading,
  formatShortDay,
  fullness,
  isDateString,
  isMissed,
  missedLabel,
  shiftDate,
  viewRange,
  weekStart,
  type CalendarView,
} from "@/lib/calendar";
import { dubaiDate, formatPromised } from "@/lib/jobs";
import { can, type RoleId } from "@/lib/roles";
import { getSettings, type Settings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { formatPlate } from "@/lib/types";
import { markReminderSent } from "./actions";
import { jobConcernsSide, sideOfDepartment } from "@/lib/inspection";
import { APPOINTMENT_SELECT, appointmentCarText, appointmentCustomerName, fillCustomerNames, reminderTemplateFor, type AppointmentFull } from "./form-data";

type JobLite = {
  id: string;
  job_number: string;
  promised_at: string | null;
  gated_out_at: string | null;
  department: string | null;
  vehicle: { has_plate: boolean; plate_country: string; plate_emirate: string | null; plate_code: string | null; plate_number: string | null; vin: string | null; make: { name: string } | null; model: { name: string } | null } | null;
};

const VEHICLE = "vehicle:vehicles(kind, has_plate, plate_country, plate_emirate, plate_code, plate_number, vin, make:vehicle_makes(name), model:vehicle_models(name))";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string; who?: string }> }) {
  const staff = await requirePermission("viewCalendar");
  const role = staff.role_id as RoleId;
  const canBook = can(role, "bookAppointments");
  const sp = await searchParams;
  const view: CalendarView = sp.view === "day" || sp.view === "month" ? sp.view : "week";
  // Opens on "My bookings" for people who book; everyone else sees all.
  const who: "me" | "all" = canBook ? (sp.who === "all" ? "all" : "me") : "all";
  const today = dubaiDate();
  const date = isDateString(sp.date) ? sp.date : today;
  const { days, from, to } = viewRange(view, date);
  const settings = await getSettings();
  const perDay = Number(settings.appointments_per_day) || 8;
  const grace = Number(settings.appointment_missed_after_minutes) || 30;
  const tomorrow = addDays(today, 1);
  const now = new Date();

  const supabase = await createClient();
  const [{ data: appts }, { data: due }, { data: out }, { data: reminders }] = await Promise.all([
    supabase.from("appointments").select(APPOINTMENT_SELECT).eq("is_active", true).gte("starts_at", dayStartIso(from)).lt("starts_at", dayStartIso(to)).order("starts_at"),
    supabase.from("jobs").select(`id, job_number, promised_at, gated_out_at, department, ${VEHICLE}`).eq("is_open", true).gte("promised_at", from).lt("promised_at", to).order("promised_at"),
    supabase.from("jobs").select(`id, job_number, promised_at, gated_out_at, department, ${VEHICLE}`).gte("gated_out_at", dayStartIso(from)).lt("gated_out_at", dayStartIso(to)).order("gated_out_at"),
    supabase.from("appointments").select(APPOINTMENT_SELECT).eq("is_active", true).eq("status", "booked").gte("starts_at", dayStartIso(tomorrow)).lt("starts_at", dayStartIso(addDays(tomorrow, 1))).order("starts_at"),
  ]);
  const mine = (a: AppointmentFull) => who === "all" || a.advisor_id === staff.id || a.created_by === staff.id;
  const managerView = role === "workshop_manager";
  const side = managerView ? sideOfDepartment(staff.department_id) : null;
  const appointments = ((appts ?? []) as unknown as AppointmentFull[]).filter(mine);
  const dueJobs = ((due ?? []) as unknown as JobLite[]).filter((j) => !managerView || jobConcernsSide(j.department, side));
  const outJobs = ((out ?? []) as unknown as JobLite[]).filter((j) => !managerView || jobConcernsSide(j.department, side));
  const tomorrowAppts = managerView ? [] : ((reminders ?? []) as unknown as AppointmentFull[]).filter(mine);
  await fillCustomerNames(supabase, [...appointments, ...tomorrowAppts]);

  const byDay = new Map<string, { appts: AppointmentFull[]; due: JobLite[]; out: JobLite[] }>();
  for (const d of days) byDay.set(d, { appts: [], due: [], out: [] });
  for (const a of appointments) byDay.get(dubaiDateOf(a.starts_at))?.appts.push(a);
  for (const j of dueJobs) if (j.promised_at) byDay.get(j.promised_at)?.due.push(j);
  for (const j of outJobs) if (j.gated_out_at) byDay.get(dubaiDateOf(j.gated_out_at))?.out.push(j);

  // The people on this calendar, each in their colour.
  const people = new Map<string, { name: string; colour: string }>();
  for (const a of appointments) if (a.advisor) people.set(a.advisor.id, { name: a.advisor.display_name, colour: colourFor(a.advisor) });

  const heading = view === "day" ? formatDayHeading(date) : view === "week" ? `Week of ${formatShortDay(weekStart(date))}` : formatMonthHeading(date);
  const href = (v: CalendarView, d: string, w: "me" | "all" = who) => `/calendar?view=${v}&date=${d}&who=${w}`;
  const ctx = { grace, now };

  return (
    <>
      <LiveRefresh tables={["appointments", "jobs"]} pollMs={120000} />
      <PageHeader
        title="Calendar"
        subtitle={heading}
        actions={canBook ? <LinkButton href={`/calendar/new?date=${view === "month" ? today : date}`} size="lg">Book</LinkButton> : undefined}
      />

      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href={href(view, shiftDate(view, date, -1))} tone="secondary" size="md" className="min-w-11">
            ‹
          </LinkButton>
          <LinkButton href={href(view, today)} tone="secondary" size="md">
            Today
          </LinkButton>
          <LinkButton href={href(view, shiftDate(view, date, 1))} tone="secondary" size="md" className="min-w-11">
            ›
          </LinkButton>
          <form action="/calendar" className="flex items-center gap-2">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="who" value={who} />
            <Input name="date" type="date" defaultValue={date} className="min-h-11" aria-label="Go to date" />
            <Button type="submit" tone="secondary" size="md">
              Go
            </Button>
          </form>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canBook ? (
            <div className="flex gap-1 rounded-control border border-line p-1">
              {(["me", "all"] as const).map((w) => (
                <Link key={w} href={href(view, date, w)} className={`min-h-9 inline-flex items-center rounded-control px-4 text-sm font-bold ${who === w ? "bg-ink text-white" : "hover:bg-chip"}`}>
                  {w === "me" ? "My bookings" : "Everyone"}
                </Link>
              ))}
            </div>
          ) : null}
          <div className="flex gap-1 rounded-control border border-line p-1">
            {(["day", "week", "month"] as CalendarView[]).map((v) => (
              <Link key={v} href={href(v, date)} className={`min-h-9 inline-flex items-center rounded-control px-4 text-sm font-bold ${view === v ? "bg-ink text-white" : "hover:bg-chip"}`}>
                {v[0].toUpperCase() + v.slice(1)}
              </Link>
            ))}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        <div className="xl:col-span-3 flex flex-col gap-4">
          {view === "month" ? (
            <MonthGrid days={days} date={date} today={today} byDay={byDay} perDay={perDay} who={who} ctx={ctx} />
          ) : view === "week" ? (
            <WeekGrid days={days} today={today} byDay={byDay} perDay={perDay} who={who} ctx={ctx} />
          ) : (
            <DayList date={date} today={today} entry={byDay.get(date)!} perDay={perDay} ctx={ctx} />
          )}
          <div className="text-xs text-muted flex flex-wrap gap-x-4 gap-y-1 items-center">
            {people.size ? (
              <>
                {[...people.values()].map((p) => (
                  <span key={p.name} className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded-full" style={{ background: p.colour }} />
                    {p.name}
                  </span>
                ))}
                <span className="text-faint">·</span>
              </>
            ) : null}
            <span><span className="inline-block w-3 h-3 align-middle rounded-sm bg-amber-soft border border-amber-bar mr-1" />Car due (promised date)</span>
            <span><span className="inline-block w-3 h-3 align-middle rounded-sm bg-green-soft border border-green mr-1" />Delivered or collected</span>
          </div>
        </div>

        <div className="flex flex-col gap-6">
          {managerView ? (
            <Card className="flex flex-col gap-2">
              <SectionLabel>Your department</SectionLabel>
              <p className="text-sm text-muted">Cars expected to arrive for {side === "bodyshop" ? "the bodyshop" : side === "mechanical" ? "mechanical" : "your department"}, and promised dates of its jobs. View only.</p>
            </Card>
          ) : null}
          <Card className={`flex flex-col gap-3 ${managerView ? "hidden" : ""}`}>
            <SectionLabel right={`${tomorrowAppts.length}`}>Reminders for tomorrow</SectionLabel>
            <p className="text-xs text-muted">{formatShortDay(tomorrow)}. Open WhatsApp with the message ready, then mark it sent.</p>
            {tomorrowAppts.length === 0 ? (
              <p className="text-sm text-muted">No bookings tomorrow{who === "me" ? " of yours" : ""}.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {tomorrowAppts.map((a) => (
                  <li key={a.id} className="py-3 flex flex-col gap-2">
                    <Link href={`/calendar/${a.id}`} className="font-semibold hover:underline underline-offset-4 inline-flex items-center gap-2">
                      <BookingIcon kind={a.kind} /> {dubaiTimeOf(a.starts_at)} · {appointmentCustomerName(a)}
                    </Link>
                    <span className="text-xs text-muted">{BOOKING_KIND_SHORT[a.kind]} · {a.reason} · {appointmentCarText(a)}</span>
                    {a.reminder_sent_at ? (
                      <Badge tone="green">Reminder sent</Badge>
                    ) : canBook ? (
                      <div className="flex flex-wrap gap-2">
                        <a href={whatsappLink(a, settings)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white">
                          WhatsApp
                        </a>
                        <form action={markReminderSent.bind(null, a.id)}>
                          <Button type="submit" tone="secondary" size="md">
                            Mark sent
                          </Button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

function whatsappLink(a: AppointmentFull, settings: Settings) {
  const digits = (a.customer?.phone ?? "").replace(/[^\d]/g, "");
  const text = fillTemplate(reminderTemplateFor(a.kind, settings), {
    name: a.customer?.full_name ?? "Customer",
    date: formatShortDay(dubaiDateOf(a.starts_at)),
    time: dubaiTimeOf(a.starts_at),
    reason: a.reason,
    car: appointmentCarText(a),
    address: a.collect_address ?? "",
    advisor: a.advisor?.display_name ?? "OFJ Automotive",
  });
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

type Ctx = { grace: number; now: Date };

function Fullness({ count, perDay, compact = false }: { count: number; perDay: number; compact?: boolean }) {
  const f = fullness(count, perDay);
  const bar = { green: "bg-green", amber: "bg-amber-bar", red: "bg-red-bar" }[f.tone];
  return (
    <div className="flex items-center gap-2" title={`${f.text} bookings`}>
      <div className="h-1.5 flex-1 rounded-full bg-track overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${f.percent}%` }} />
      </div>
      {!compact ? <span className="text-[11px] text-muted whitespace-nowrap">{f.text}</span> : null}
    </div>
  );
}

/** One booking on the grid: the person's colour on the left, the type as an icon and label, the person's name. */
function ApptItem({ a, ctx, compact = false }: { a: AppointmentFull; ctx: Ctx; compact?: boolean }) {
  const faded = a.status === "no_show" || a.status === "cancelled";
  const missed = isMissed(a, ctx.grace, ctx.now);
  const colour = colourFor(a.advisor);
  return (
    <Link
      href={`/calendar/${a.id}`}
      className={`block rounded-control border border-line border-l-4 px-2 py-1.5 hover:border-ink ${a.status === "arrived" || a.status === "done" ? "bg-green-soft" : "bg-white"} ${faded ? "opacity-60" : ""}`}
      style={{ borderLeftColor: colour }}
    >
      <span className={`flex items-center gap-1.5 text-xs font-bold ${faded ? "line-through" : ""}`}>
        <BookingIcon kind={a.kind} size={14} />
        <span className="truncate">
          {dubaiTimeOf(a.starts_at)} {appointmentCustomerName(a)}
        </span>
      </span>
      {!compact ? (
        <span className="block text-[11px] text-muted truncate">
          {BOOKING_KIND_SHORT[a.kind]} · {a.reason}
        </span>
      ) : null}
      <span className="flex items-center gap-1 text-[11px] font-semibold truncate" style={{ color: colour }}>
        <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: colour }} />
        {a.advisor?.display_name ?? "Not assigned"}
      </span>
      {missed ? <span className="block text-[11px] font-bold text-red">{missedLabel(a.kind)}</span> : null}
      {a.status === "no_show" ? <span className="block text-[11px] font-semibold text-red">No-show</span> : null}
      {a.status === "cancelled" ? <span className="block text-[11px] font-semibold text-muted">Cancelled</span> : null}
    </Link>
  );
}

function JobItem({ j, kind, compact = false }: { j: JobLite; kind: "due" | "out"; compact?: boolean }) {
  const cls = kind === "due" ? "bg-amber-soft border-amber-bar" : "bg-green-soft border-green";
  return (
    <Link href={`/jobs/${j.id}`} className={`block rounded-control border px-2 py-1.5 hover:border-ink ${cls}`}>
      <span className="block text-xs font-bold">
        {kind === "due" ? "Due" : `Left ${j.gated_out_at ? dubaiTimeOf(j.gated_out_at) : ""}`} · {j.vehicle ? formatPlate(j.vehicle) : j.job_number}
      </span>
      {!compact ? <span className="block text-[11px] text-muted truncate">{[j.vehicle?.make?.name, j.vehicle?.model?.name].filter(Boolean).join(" ")} · {j.job_number}</span> : null}
    </Link>
  );
}

type Entry = { appts: AppointmentFull[]; due: JobLite[]; out: JobLite[] };

const active = (a: AppointmentFull) => a.status === "booked" || a.status === "arrived" || a.status === "done";

function MonthGrid({ days, date, today, byDay, perDay, who, ctx }: { days: string[]; date: string; today: string; byDay: Map<string, Entry>; perDay: number; who: string; ctx: Ctx }) {
  const month = date.slice(0, 7);
  return (
    <Card className="p-2 sm:p-3">
      <div className="grid grid-cols-7 gap-1 mb-1">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d} className="text-center text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const e = byDay.get(d)!;
          const inMonth = d.startsWith(month);
          const items = [...e.appts.map((a) => ({ key: a.id, node: <ApptItem a={a} ctx={ctx} compact /> })), ...e.due.map((j) => ({ key: "d" + j.id, node: <JobItem j={j} kind="due" compact /> })), ...e.out.map((j) => ({ key: "o" + j.id, node: <JobItem j={j} kind="out" compact /> }))];
          const shown = items.slice(0, 3);
          return (
            <div key={d} className={`min-h-28 rounded-control border p-1.5 flex flex-col gap-1 ${d === today ? "border-ink" : "border-line"} ${inMonth ? "bg-white" : "bg-canvas opacity-60"}`}>
              <Link href={`/calendar?view=day&date=${d}&who=${who}`} className={`text-xs font-bold self-start min-h-6 min-w-6 inline-flex items-center justify-center rounded-full ${d === today ? "bg-ink text-white px-1.5" : "hover:underline"}`}>
                {Number(d.slice(8, 10))}
              </Link>
              <Fullness count={e.appts.filter(active).length} perDay={perDay} compact />
              {shown.map((i) => (
                <div key={i.key}>{i.node}</div>
              ))}
              {items.length > shown.length ? (
                <Link href={`/calendar?view=day&date=${d}&who=${who}`} className="text-[11px] font-semibold text-muted hover:underline">
                  +{items.length - shown.length} more
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WeekGrid({ days, today, byDay, perDay, who, ctx }: { days: string[]; today: string; byDay: Map<string, Entry>; perDay: number; who: string; ctx: Ctx }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-7 gap-2">
      {days.map((d) => {
        const e = byDay.get(d)!;
        return (
          <Card key={d} className={`p-2 flex flex-col gap-1.5 ${d === today ? "border-ink" : ""}`}>
            <Link href={`/calendar?view=day&date=${d}&who=${who}`} className="text-xs font-bold hover:underline underline-offset-4">
              {formatShortDay(d)}
              {d === today ? " · Today" : ""}
            </Link>
            <Fullness count={e.appts.filter(active).length} perDay={perDay} />
            {e.appts.map((a) => (
              <ApptItem key={a.id} a={a} ctx={ctx} />
            ))}
            {e.due.map((j) => (
              <JobItem key={"d" + j.id} j={j} kind="due" />
            ))}
            {e.out.map((j) => (
              <JobItem key={"o" + j.id} j={j} kind="out" />
            ))}
            {e.appts.length + e.due.length + e.out.length === 0 ? <span className="text-[11px] text-faint">Nothing booked</span> : null}
          </Card>
        );
      })}
    </div>
  );
}

function DayList({ date, today, entry, perDay, ctx }: { date: string; today: string; entry: Entry; perDay: number; ctx: Ctx }) {
  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2">
        <SectionLabel right={date === today ? "Today" : undefined}>Bookings</SectionLabel>
        <Fullness count={entry.appts.filter(active).length} perDay={perDay} />
        {entry.appts.length === 0 ? (
          <p className="text-sm text-muted">No bookings on this day.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {entry.appts.map((a) => {
              const colour = colourFor(a.advisor);
              const missed = isMissed(a, ctx.grace, ctx.now);
              return (
                <li key={a.id} className="py-3">
                  <Link href={`/calendar/${a.id}`} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 hover:underline underline-offset-4 border-l-4 pl-3" style={{ borderLeftColor: colour }}>
                    <span className="text-lg font-extrabold w-16 shrink-0">{dubaiTimeOf(a.starts_at)}</span>
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="font-semibold inline-flex items-center gap-2">
                        <BookingIcon kind={a.kind} /> {appointmentCustomerName(a)}
                        {a.customer?.is_vip ? <Badge tone="ink">VIP</Badge> : null}
                      </span>
                      <span className="text-sm text-muted">
                        {BOOKING_KIND_SHORT[a.kind]} · {a.reason} · {appointmentCarText(a)}
                        {a.kind === "customer_visit" ? ` · ${a.duration_minutes} min` : ""}
                      </span>
                      <span className="text-xs font-semibold" style={{ color: colour }}>
                        {a.advisor?.display_name ?? "Not assigned"}
                      </span>
                    </span>
                    <span className="shrink-0 flex gap-1">
                      {missed ? <Badge tone="red">{missedLabel(a.kind)}</Badge> : a.status === "booked" ? <Badge tone="outline">Booked</Badge> : a.status === "arrived" ? <Badge tone="green">Arrived</Badge> : a.status === "done" ? <Badge tone="green">Done</Badge> : a.status === "no_show" ? <Badge tone="red">No-show</Badge> : <Badge tone="neutral">Cancelled</Badge>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="flex flex-col gap-2">
          <SectionLabel right={`${entry.due.length}`}>Cars due</SectionLabel>
          {entry.due.length === 0 ? <p className="text-sm text-muted">No promised dates on this day.</p> : entry.due.map((j) => <JobItem key={j.id} j={j} kind="due" />)}
          {entry.due.length ? <p className="text-[11px] text-muted">{formatPromised(date)}</p> : null}
        </Card>
        <Card className="flex flex-col gap-2">
          <SectionLabel right={`${entry.out.length}`}>Delivered or collected</SectionLabel>
          {entry.out.length === 0 ? <p className="text-sm text-muted">No cars left the workshop on this day.</p> : entry.out.map((j) => <JobItem key={j.id} j={j} kind="out" />)}
        </Card>
      </div>
    </div>
  );
}

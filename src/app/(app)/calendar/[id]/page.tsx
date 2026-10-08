import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingIcon } from "@/components/BookingIcons";
import { Badge, Button, Card, DescriptionList, Input, LinkButton, Notice, PageHeader, SectionLabel } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { APPOINTMENT_STATUS_LABELS, BOOKING_KIND_LABELS, COLLECT_METHODS, colourFor, dubaiDateOf, dubaiTimeOf, fillTemplate, formatDayHeading, formatShortDay, isMissed, missedLabel } from "@/lib/calendar";
import { formatDateTime } from "@/lib/format";
import { can, type RoleId } from "@/lib/roles";
import { getSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";
import { markReminderSent, setAppointmentStatus } from "../actions";
import { APPOINTMENT_SELECT, appointmentCarText, appointmentCustomerName, canEditAppointment, reminderTemplateFor, type AppointmentFull } from "../form-data";

export default async function AppointmentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ message?: string; error?: string }> }) {
  const staff = await requireStaff();
  const role = staff.role_id as RoleId;
  const { id } = await params;
  const { message, error } = await searchParams;
  const supabase = await createClient();
  const [{ data }, settings] = await Promise.all([supabase.from("appointments").select(APPOINTMENT_SELECT).eq("id", id).maybeSingle(), getSettings()]);
  if (!data) notFound();
  const a = data as unknown as AppointmentFull;
  const canEdit = can(role, "bookAppointments") && canEditAppointment(staff, a);
  const canGateIn = can(role, "gateIn");
  const date = dubaiDateOf(a.starts_at);
  const digits = (a.customer?.phone ?? "").replace(/[^\d]/g, "");
  const reminder = fillTemplate(reminderTemplateFor(a.kind, settings), {
    name: a.customer?.full_name ?? "Customer",
    date: formatShortDay(date),
    time: dubaiTimeOf(a.starts_at),
    reason: a.reason,
    car: appointmentCarText(a),
    address: a.collect_address ?? "",
    advisor: a.advisor?.display_name ?? staff.display_name,
  });
  const gateInHref = a.vehicle_id ? `/gate-in/new?vehicle=${a.vehicle_id}&appointment=${a.id}` : `/gate-in/new-car?appointment=${a.id}`;
  const missed = isMissed(a, Number(settings.appointment_missed_after_minutes) || 30);
  const colour = colourFor(a.advisor);
  const statusTone = { booked: "outline", arrived: "green", done: "green", no_show: "red", cancelled: "neutral" } as const;

  return (
    <>
      <PageHeader
        title={`${dubaiTimeOf(a.starts_at)} · ${appointmentCustomerName(a)}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <BookingIcon kind={a.kind} /> {BOOKING_KIND_LABELS[a.kind]}
            </span>
            <span>· {formatDayHeading(date)}</span>
            {missed ? <Badge tone="red">{missedLabel(a.kind)}</Badge> : <Badge tone={statusTone[a.status]}>{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>}
            {a.customer?.is_vip ? <Badge tone="ink">VIP</Badge> : null}
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold" style={{ color: colour }}>
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: colour }} />
              {a.advisor?.display_name ?? "Not assigned"}
            </span>
          </span>
        }
        actions={
          <>
            {a.job_id ? (
              <LinkButton href={`/jobs/${a.job_id}`} size="lg">
                Open job card{a.job ? ` ${a.job.job_number}` : ""}
              </LinkButton>
            ) : canGateIn && a.kind !== "customer_collects" && a.status !== "cancelled" ? (
              <LinkButton href={gateInHref} size="lg">
                Start gate-in
              </LinkButton>
            ) : null}
            {canEdit ? (
              <LinkButton href={`/calendar/${a.id}/edit`} tone="secondary" size="lg">
                Change
              </LinkButton>
            ) : null}
          </>
        }
      />
      {message ? <Notice tone="success">{message}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2 flex flex-col gap-4">
          <SectionLabel>Booking</SectionLabel>
          <DescriptionList
            items={[
              { label: "Type", value: BOOKING_KIND_LABELS[a.kind] },
              { label: "Customer", value: <Link href={`/customers/${a.customer_id}`} className="font-semibold hover:underline underline-offset-4">{appointmentCustomerName(a)}</Link> },
              { label: "Phone", value: a.customer?.phone ?? null },
              { label: "Car", value: a.vehicle_id ? <Link href={`/vehicles/${a.vehicle_id}`} className="font-semibold hover:underline underline-offset-4">{appointmentCarText(a)}</Link> : appointmentCarText(a) },
              { label: a.kind === "customer_collects" ? "Note" : "Reason for visit", value: a.reason },
              ...(a.kind === "we_collect"
                ? [
                    { label: "Collection address", value: a.collect_address },
                    { label: "How we collect", value: COLLECT_METHODS.find((m) => m.value === a.collect_method)?.label ?? null },
                  ]
                : []),
              { label: "When", value: `${formatDayHeading(date)} at ${dubaiTimeOf(a.starts_at)}${a.kind === "customer_visit" ? `, ${a.duration_minutes} min` : ""}` },
              { label: "Assigned to", value: a.advisor?.display_name ?? "Not assigned yet" },
              ...(a.job ? [{ label: "Job card", value: <Link href={`/jobs/${a.job_id}`} className="font-semibold hover:underline underline-offset-4">{a.job.job_number}</Link> }] : []),
              ...(a.notes ? [{ label: "Notes", value: <span className="whitespace-pre-wrap">{a.notes}</span> }] : []),
              ...(a.cancel_reason ? [{ label: "Cancelled because", value: a.cancel_reason }] : []),
              { label: "Booked", value: formatDateTime(a.created_at) },
            ]}
          />
        </Card>

        <div className="flex flex-col gap-6">
          <Card className="flex flex-col gap-3">
            <SectionLabel>Customer reminder</SectionLabel>
            {a.reminder_sent_at ? (
              <Notice tone="success">Reminder sent on {formatDateTime(a.reminder_sent_at)}.</Notice>
            ) : (
              <p className="text-sm text-muted">Send it the day before. The message is ready; WhatsApp opens with it filled in.</p>
            )}
            <p className="text-sm whitespace-pre-wrap rounded-control bg-chip px-3 py-2">{reminder}</p>
            {canEdit && a.status === "booked" ? (
              <div className="flex flex-wrap gap-2">
                <a href={`https://wa.me/${digits}?text=${encodeURIComponent(reminder)}`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center rounded-control bg-ink px-4 text-sm font-bold text-white">
                  Open WhatsApp
                </a>
                {!a.reminder_sent_at ? (
                  <form action={markReminderSent.bind(null, a.id)}>
                    <Button type="submit" tone="secondary" size="md">
                      Mark sent
                    </Button>
                  </form>
                ) : null}
              </div>
            ) : null}
          </Card>

          {canEdit && a.status !== "arrived" ? (
            <Card className="flex flex-col gap-3">
              <SectionLabel>Status</SectionLabel>
              {a.status === "booked" ? (
                <>
                  {a.kind === "customer_collects" || a.kind === "we_collect" ? (
                    <form action={setAppointmentStatus.bind(null, a.id)}>
                      <input type="hidden" name="status" value="done" />
                      <Button type="submit" size="md" className="w-full">
                        {a.kind === "we_collect" ? "Car collected" : "Customer collected the car"}
                      </Button>
                    </form>
                  ) : null}
                  <form action={setAppointmentStatus.bind(null, a.id)}>
                    <input type="hidden" name="status" value="no_show" />
                    <Button type="submit" tone="secondary" size="md" className="w-full">
                      {a.kind === "we_collect" ? "Could not collect" : "Customer did not show up"}
                    </Button>
                  </form>
                  <form action={setAppointmentStatus.bind(null, a.id)} className="flex flex-col gap-2">
                    <input type="hidden" name="status" value="cancelled" />
                    <Input name="cancel_reason" placeholder="Reason for cancelling (optional)" />
                    <Button type="submit" tone="danger" size="md" className="w-full">
                      Cancel booking
                    </Button>
                  </form>
                </>
              ) : (
                <form action={setAppointmentStatus.bind(null, a.id)}>
                  <input type="hidden" name="status" value="booked" />
                  <Button type="submit" tone="secondary" size="md" className="w-full">
                    Put it back to booked
                  </Button>
                </form>
              )}
            </Card>
          ) : null}
          {!canEdit && can(role, "bookAppointments") ? <p className="text-xs text-muted">This booking belongs to {a.advisor?.display_name ?? "someone else"}. Only they, or the owner, can change it.</p> : null}
        </div>
      </div>
    </>
  );
}
